import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import multer from "multer";
import sharp from "sharp";
import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { LegalConsent } from "./legal.js";
import { RoomActivity } from "./room-activity.js";
import { AVATARS } from "../shared/cards.js";
import {
  addApplicant,
  admitted,
  applyAction,
  connectionChanged,
  createRoom,
  defaultSettings,
  GameError,
  log,
  pause,
  requireThat,
  selfPlayer,
  textInput,
  tickRoom,
  validateSettings,
  viewFor,
} from "./engine.js";
import type { Actor, Room, RoomAction } from "../shared/types.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir =
  process.env.DATA_DIR === undefined
    ? join(root, "data")
    : resolve(process.env.DATA_DIR);
const store = new Store(dataDir);
const legal = new LegalConsent(store.db);
const activity = new RoomActivity(store.db);
store.bootstrapDevelopment();
const rooms = new Map<string, Room>();
for (const saved of store.rooms()) {
  activity.seed(saved.id, saved.persistedAt);
  if (saved.pendingDirection === undefined) saved.pendingDirection = null;
  saved.ownerOnline = false;
  for (const p of saved.players) p.online = false;
  if (saved.state === "running") {
    requireThat(Number.isFinite(saved.persistedAt),"快照缺少计时检查点，不能恢复计时");
    pause(saved, "服务已重启，请确认现场后继续",saved.persistedAt);
  }
  if (saved.state !== "ended" && saved.controllerId !== saved.ownerId) {
    saved.controllerId = saved.ownerId;
    log(saved, "服务重启后等待原主持恢复身份");
  }
  store.saveRoom(saved);
  rooms.set(saved.code, saved);
}
const app = express();
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 65536, serveClient: false });
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=()");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "128kb" }));
const attempts = new Map<string, { n: number; until: number }>();
function rate(key: string, max: number, period = 60000) {
  const now = Date.now();
  let item = attempts.get(key);
  if (!item || item.until < now) {
    item = { n: 0, until: now + period };
    attempts.set(key, item);
  }
  item.n++;
  requireThat(item.n <= max, "操作太频繁，请稍后重试");
}
const actorFor = (req: Request): Actor => {
  const header = req.headers.authorization;
  requireThat(
    typeof header === "string" && header.startsWith("Bearer "),
    "请先登录或加入房间",
  );
  return store.authenticate(header.slice(7));
};
const roomFor = (code: string): Room => {
  const r = rooms.get(code);
  requireThat(r, "房间不存在或已清理");
  return r;
};
function cleanupAvatars(room: Room) {
  const folder = join(dataDir, "uploads", room.id);
  if (existsSync(folder)) rmSync(folder, { recursive: true });
  for (const p of room.players)
    if (p.avatar.startsWith("/uploads/")) p.avatar = AVATARS[0];
}
function commit(room: Room, userAction = false) {
  if (room.state === "ended") cleanupAvatars(room);
  store.saveRoom(room);
  if (userAction) activity.touch(room.id);
  rooms.set(room.code, room);
}
function sendViews(room: Room) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.code !== room.code) continue;
    const actor = socket.data.actor as Actor;
    try {
      socket.emit("room", viewFor(room, actor));
    } catch (error) {
      socket.emit(
        "server:error",
        error instanceof Error ? error.message : "身份错误",
      );
    }
  }
}
const route =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "snakeknotcard" }),
);
app.get("/api/default-settings", (_req, res) => res.json(defaultSettings()));
legal.routes(app);
app.use("/api", (req, res, next) => {
  if (!legal.valid(req.headers.cookie)) { res.status(403).json({ error: "请先阅读并确认当前使用条款与隐私政策" }); return; }
  next();
});
app.post(
  "/api/login",
  route((req, res) => {
    rate(`login:${req.socket.remoteAddress}`, 10, 60000);
    const actor = store.login(req.body.login, req.body.password);
    res.json(store.session(actor));
  }),
);
app.get(
  "/api/session",
  route((req, res) => res.json({ actor: actorFor(req) })),
);
app.get(
  "/api/host/room",
  route((req, res) => {
    const actor = actorFor(req);
    requireThat(actor.kind === "host", "需要主持账号");
    res.json({
      code:
        [...rooms.values()].find(
          (r) => r.ownerId === actor.id && r.state !== "ended",
        )?.code ?? null,
    });
  }),
);
app.post(
  "/api/rooms",
  route((req, res) => {
    const actor = actorFor(req);
    requireThat(actor.kind === "host", "需要主持账号");
    rate(`create:${actor.id}`, 6);
    requireThat(
      ![...rooms.values()].some(
        (r) => r.ownerId === actor.id && r.state !== "ended",
      ),
      "此账号已有未结束房间，请先恢复该房间",
    );
    requireThat(
      [...rooms.values()].filter((r) => r.state !== "ended").length < 3,
      "当前最多同时 3 间未结束房间",
    );
    let code: string;
    do {
      code = String(randomInt(100000, 1000000));
    } while (rooms.has(code));
    const room = createRoom(
      actor,
      textInput(req.body.name, "昵称"),
      code,
      req.body.participate,
      req.body.settings,
      req.body.avatar,
    );
    commit(room, true);
    res.status(201).json({ code });
  }),
);
app.post(
  "/api/join",
  route((req, res) => {
    rate(`join:${req.socket.remoteAddress}`, 120);
    const code = textInput(req.body.code, "房间码", 6);
    requireThat(/^\d{6}$/.test(code), "房间码需为 6 位数字");
    const original = roomFor(code);
    const room = structuredClone(original);
    const id = randomUUID();
    addApplicant(room, req.body.name, req.body.avatar, id);
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.saveRoom(room);
      activity.touch(room.id);
      const session = store.session({ id, kind: "player", roomCode: code });
      store.db.exec("COMMIT");
      rooms.set(code, room);
      sendViews(room);
      res.status(201).json({ ...session, avatarMatchId: room.matchId });
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.get(
  "/api/rooms/:code",
  route((req, res) =>
    res.json(viewFor(roomFor(String(req.params.code)), actorFor(req))),
  ),
);
app.get(
  "/api/presets",
  route((req, res) => {
    const actor = actorFor(req);
    requireThat(actor.kind === "host", "仅预设主持账号可管理模板");
    res.json(store.presets(actor.id));
  }),
);
app.post(
  "/api/presets",
  route((req, res) => {
    const actor = actorFor(req);
    requireThat(actor.kind === "host", "仅预设主持账号可管理模板");
    requireThat(
      store.presets(actor.id).length < 30 || req.body.id !== undefined,
      "最多保存 30 套配置",
    );
    const settings = validateSettings(req.body.settings);
    const id = store.savePreset(
      actor.id,
      textInput(req.body.name, "模板名称", 32),
      settings,
      req.body.id,
    );
    res.json({ id });
  }),
);
app.delete(
  "/api/presets/:id",
  route((req, res) => {
    const actor = actorFor(req);
    requireThat(actor.kind === "host", "需要主持账号");
    store.deletePreset(actor.id, String(req.params.id));
    res.json({ ok: true });
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 },
});
app.post(
  "/api/rooms/:code/avatar",
  (req, res, next) => {
    try {
      const actor = actorFor(req);
      rate(`upload:${actor.id}`, 10);
      const room = roomFor(String(req.params.code));
      requireThat(room.state !== "ended", "牌局结束后不能上传头像");
      requireThat(
        req.headers["x-match-id"] === room.matchId,
        "牌局已变化，请刷新后重新选择头像",
      );
      const pid = actor.id === room.ownerId ? room.hostPlayerId : actor.id;
      requireThat(
        room.players.some((p) => p.id === pid && !p.removed),
        "没有可上传头像的玩家身份",
      );
      res.locals.actor = actor;
      res.locals.pid = pid;
      res.locals.matchId = room.matchId;
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("avatar"),
  route(async (req, res) => {
    requireThat(req.file, "请选择图片");
    const actor = res.locals.actor as Actor;
    const pid = res.locals.pid as string;
    const meta = await sharp(req.file.buffer, {
      limitInputPixels: 16_000_000,
    }).metadata();
    requireThat(
      meta.format &&
        ["jpeg", "png", "webp", "gif", "heif"].includes(meta.format),
      "只支持有效的 JPEG、PNG、WebP、GIF 或 HEIF 图片",
    );
    const output = await sharp(req.file.buffer, {
      limitInputPixels: 16_000_000,
    })
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    // Re-read after asynchronous decoding so an ended/kicked session cannot upload late.
    store.authenticate(req.headers.authorization!.slice(7));
    const room = structuredClone(roomFor(String(req.params.code)));
    requireThat(room.state !== "ended", "牌局已经结束，头像未保存");
    requireThat(
      room.matchId === res.locals.matchId,
      "上传期间牌局已变化，旧局头像未保存",
    );
    const p = room.players.find((p) => p.id === pid && !p.removed);
    requireThat(p, "玩家已被移除");
    requireThat(
      actor.id === room.ownerId || actor.id === pid,
      "不能替其他玩家上传",
    );
    const filename = `${randomUUID()}.webp`;
    const folder = join(dataDir, "uploads", room.id);
    mkdirSync(folder, { recursive: true });
    const filepath = join(folder, filename);
    writeFileSync(filepath, output, { mode: 0o600 });
    const previous = p.avatar;
    p.avatar = `/uploads/${room.id}/${filename}`;
    room.version++;
    try {
      commit(room, true);
    } catch (e) {
      rmSync(filepath);
      throw e;
    }
    if (previous.startsWith("/uploads/")) {
      const old = join(dataDir, previous.slice(1));
      if (existsSync(old)) rmSync(old);
    }
    sendViews(room);
    res.json({ avatar: p.avatar });
  }),
);
app.use(
  "/uploads",
  express.static(join(dataDir, "uploads"), {
    dotfiles: "deny",
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "image/webp");
    },
  }),
);
app.use("/uploads", (_req, res) =>
  res.status(404).json({ error: "头像不存在或已随牌局结束删除" }),
);

io.use((socket, next) => {
  try {
    legal.require(socket.handshake.headers.cookie);
    const actor = store.authenticate(socket.handshake.auth.token);
    socket.data.actor = actor;
    next();
  } catch (error) {
    next(new Error(error instanceof Error ? error.message : "认证失败"));
  }
});
function actorOnline(roomCode: string, actorId: string, except?: string) {
  return [...io.sockets.sockets.values()].some(
    (s) =>
      s.id !== except &&
      s.data.code === roomCode &&
      s.data.actor?.id === actorId,
  );
}
io.on("connection", (socket) => {
  const authenticate = () => {
    legal.require(socket.handshake.headers.cookie);
    const actor = store.authenticate(socket.handshake.auth.token);
    requireThat(actor.id === socket.data.actor.id, "身份已变化");
    return actor;
  };
  socket.on("watch", (code: unknown, ack: (data: unknown) => void) => {
    if (typeof ack !== "function") {
      socket.emit("server:error", "连接请求缺少确认回调，未执行");
      return;
    }
    try {
      const actor = authenticate();
      const value = textInput(code, "房间码", 6);
      const room = roomFor(value);
      viewFor(room, actor);
      requireThat(
        !socket.data.code || socket.data.code === value,
        "请重新连接后切换房间",
      );
      socket.data.code = value;
      const next = connectionChanged(room, actor, true);
      commit(next);
      sendViews(next);
      ack({ ok: true });
    } catch (error) {
      ack({
        ok: false,
        error: error instanceof Error ? error.message : "连接房间失败",
      });
    }
  });
  socket.on("action", (action: RoomAction, ack: (data: unknown) => void) => {
    if (typeof ack !== "function") {
      socket.emit("server:error", "操作缺少确认回调，未执行");
      return;
    }
    try {
      const actor = authenticate();
      requireThat(socket.data.code, "尚未连接房间");
      rate(`action:${actor.id}`, 180, 60000);
      const old = roomFor(socket.data.code);
      const next = applyAction(old, actor, action);
      if (next !== old) {
        commit(next, true);
        sendViews(next);
        if(next.alertEvent && next.alertEvent.id!==old.alertEvent?.id){
          for(const targetSocket of io.sockets.sockets.values()){
            if(targetSocket.data.code!==next.code)continue;
            const targetActor=targetSocket.data.actor as Actor;
            if(selfPlayer(next,targetActor)===next.alertEvent.targetId)targetSocket.emit("down-alert",next.alertEvent);
          }
        }
        for (const p of next.players) {
          if (
            p.removed &&
            !old.players.find((previous) => previous.id === p.id)?.removed
          ) {
            store.revokePlayer(p.id);
            for (const memberSocket of io.sockets.sockets.values())
              if (memberSocket.data.actor?.id === p.id)
                memberSocket.disconnect(true);
          }
        }
      }
      ack({ ok: true });
    } catch (error) {
      ack({
        ok: false,
        error: error instanceof Error ? error.message : "操作失败",
      });
    }
  });
  socket.on("disconnect", () => {
    const actor = socket.data.actor as Actor;
    const code = socket.data.code as string | undefined;
    if (!code || !rooms.has(code) || actorOnline(code, actor.id, socket.id))
      return;
    try {
      const next = connectionChanged(roomFor(code), actor, false);
      commit(next);
      sendViews(next);
    } catch (error) {
      console.error("断线状态更新失败", error);
      io.emit("server:error", "断线状态保存失败，请暂停操作并检查服务器");
    }
  });
});
const ticker = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try {
      if (activity.expired(room.id, now) || (room.endedAt !== null && now - room.endedAt > 24 * 60 * 60 * 1000)) {
        cleanupAvatars(room);
        for (const p of room.players) store.revokePlayer(p.id);
        store.removeRoom(room.code);
        activity.remove(room.id);
        rooms.delete(room.code);
        for (const socket of io.sockets.sockets.values()) if (socket.data.code === room.code) {
          socket.emit("server:error", "房间已满24小时无操作或已结束超过24小时，已终止并清理，请重新入场");
          socket.disconnect(true);
        }
        continue;
      }
      const next = tickRoom(room, now);
      if (next !== room) {
        commit(next);
        sendViews(next);
      } else if(room.state==="running"&&room.turn?.deadline!==undefined&&now-room.persistedAt>=1000){
        store.saveRoom(room);
      }
    } catch (error) {
      console.error("牌局定时维护失败", error);
      for (const socket of io.sockets.sockets.values())
        if (socket.data.code === room.code)
          socket.emit("server:error", "服务器维护失败，请联系主持人检查");
    }
  }
  for (const [key, item] of attempts)
    if (item.until < now) attempts.delete(key);
}, 500);
const maintenance = setInterval(() => { legal.prune(Date.now()); }, 15000);

let closeDevelopment: (() => Promise<void>) | null = null;
if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(root, "dist"), { maxAge: "1h" }));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(join(root, "dist", "index.html")),
  );
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server: http } },
    appType: "spa",
  });
  app.use(vite.middlewares);
  closeDevelopment = () => vite.close();
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const expected =
    error instanceof GameError || error instanceof multer.MulterError;
  if (!expected) console.error(error);
  const message =
    error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "头像不能超过 3 MB"
      : error instanceof Error
        ? error.message
        : "服务器错误";
  res.status(expected ? 400 : 500).json({ error: message });
});
const port = process.env.PORT === undefined ? 5173 : Number(process.env.PORT);
requireThat(Number.isInteger(port) && port > 0 && port < 65536, "PORT 无效");
const bindHost = process.env.BIND_HOST === undefined ? "0.0.0.0" : process.env.BIND_HOST;
requireThat(["0.0.0.0", "127.0.0.1", "::1", "::"].includes(bindHost), "BIND_HOST 无效");
http.listen(port, bindHost, () =>
  console.log(`蛇结已启动：http://localhost:${port}`),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(ticker);
  clearInterval(maintenance);
  try {
    if (closeDevelopment) await closeDevelopment();
    io.close(() => {
      store.close();
      process.exit(0);
    });
  } catch (error) {
    console.error("关闭服务失败", error);
    process.exit(1);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

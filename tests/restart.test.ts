import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { Store } from "../server/store.js";
import type { RoomView, Session, GameSettings } from "../shared/types.js";
const base = "http://127.0.0.1:5198";
test(
  "真实服务重启恢复同一回合、剩余数量与身份，并保持暂停",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "snake-restart-"));
    const store = new Store(dir);
    store.createHost("restart-host", "restart-test-password");
    store.close();
    let child: ChildProcess | null = null;
    const sockets: Socket[] = [];
    let output = "";
    async function launch() {
      child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        env: { ...process.env, PORT: "5198", DATA_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout!.on("data", (c) => {
        output += String(c);
      });
      child.stderr!.on("data", (c) => {
        output += String(c);
      });
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        if (child.exitCode !== null) throw new Error(output);
        try {
          const res = await fetch(base + "/api/health");
          if (res.ok) return;
        } catch (e) {
          if (Date.now() + 100 >= until) throw e;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("重启测试服务未就绪：" + output);
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const current = child;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          current.kill("SIGKILL");
          reject(new Error("测试子服务未正常停止"));
        }, 5000);
        current.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        current.kill("SIGTERM");
      });
      child = null;
    }
    async function post<T>(
      path: string,
      data: unknown,
      token?: string,
    ): Promise<T> {
      const consent = await fetch(base + "/api/legal/accept", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:"example-2026-11-23.1",adult:true,accepted:true})});
      const res = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: consent.headers.get("set-cookie")!.split(";")[0],
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      assert.equal(res.ok, true, JSON.stringify(payload));
      return payload as T;
    }
    async function connect(session: Session, code: string) {
      const consent = await fetch(base + "/api/legal/accept", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:"example-2026-11-23.1",adult:true,accepted:true})});
      const socket = io(base, {
        extraHeaders: { Cookie: consent.headers.get("set-cookie")!.split(";")[0] },
        auth: { token: session.token },
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      let view: RoomView | undefined;
      socket.on("room", (v) => {
        if ("matchId" in v) view = v;
      });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect_error", reject);
        socket.on("connect", () =>
          socket.emit("watch", code, (r: { ok: boolean; error?: string }) =>
            r.ok ? resolve() : reject(new Error(r.error)),
          ),
        );
      });
      return {
        get view() {
          assert.ok(view);
          return view;
        },
        action: async (type: string, data: Record<string, unknown> = {}) => {
          await new Promise<void>((resolve, reject) =>
            socket.emit(
              "action",
              {
                type,
                data: { ...data, turnId: view?.turn?.id },
                requestId: randomUUID(),
                matchId: view?.matchId,
              },
              (r: { ok: boolean; error?: string }) =>
                r.ok ? resolve() : reject(new Error(r.error)),
            ),
          );
        },
      };
    }
    try {
      await launch();
      const owner = await post<Session>("/api/login", {
        login: "restart-host",
        password: "restart-test-password",
      });
      const defaults = (await fetch(base + "/api/default-settings").then((r) =>
        r.json(),
      )) as GameSettings;
      for (const c of Object.values(defaults.config)) c.count = 0;
      defaults.config.c02.count = 2;
      const { code } = await post<{ code: string }>(
        "/api/rooms",
        {
          name: "重启主持",
          participate: true,
          settings: defaults,
          avatar: "c03",
        },
        owner.token,
      );
      const h = await connect(owner, code);
      const guest = await post<Session>("/api/join", {
        code,
        name: "重启玩家",
        avatar: "c07",
      });
      await h.action("approve", { playerId: guest.actor.id });
      await connect(guest, code);
      await h.action("seat-insert", {
        afterId: h.view.seats[0].id,
        kind: "player",
        playerId: guest.actor.id,
      });
      await h.action("start");
      await h.action("draw");
      const before = structuredClone(h.view);
      await stop();
      await launch();
      const restored = await connect(owner, code);
      assert.equal(restored.view.state, "paused");
      assert.equal(restored.view.matchId, before.matchId);
      assert.equal(restored.view.turn!.id, before.turn!.id);
      assert.equal(restored.view.turn!.cardId, "c02");
      assert.equal(restored.view.remaining.c02, 1);
      assert.equal(restored.view.drawCount, 1);
      await restored.action("end");
      await stop();
      // 模拟关机期间经过一分钟；软件传花应从最后持久检查点冻结，不消耗离线时间。
      const fixture=new Store(dir);
      const saved=fixture.rooms()[0];
      saved.state="running";saved.persistedAt=Date.now()-60000;
      saved.turn!.task={kind:"flower",exploded:false,holderId:null};
      saved.turn!.cardId="c21";saved.turn!.autoAdvance=false;saved.turn!.deadline=saved.persistedAt+15000;
      fixture.db.prepare("UPDATE rooms SET state=?,payload=? WHERE code=?").run(saved.state,JSON.stringify(saved),code);
      fixture.close();
      await launch();
      const timerRestored=await connect(owner,code);
      assert.equal(timerRestored.view.state,"paused");
      assert.equal(timerRestored.view.turn!.deadline,undefined);
      const check=new Store(dir);
      assert.equal(check.rooms()[0].turn!.remainingMs,15000);
      check.close();
      await timerRestored.action("end");
    } finally {
      for (const socket of sockets) socket.disconnect();
      await stop();
      rmSync(dir, { recursive: true });
    }
  },
);

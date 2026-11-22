import { randomInt, randomUUID } from "node:crypto";
import { AVATARS, CARDS, cardById, effectDuration } from "../shared/cards.js";
import { connect, grant, identities, removeIdentityPlayer } from "./identities.js";
import { gates, guessGate, revealIfReady } from "./tasks.js";
import type {
  Actor,
  CardConfigs,
  GameSettings,
  Room,
  RoomAction,
  RoomView,
  Seat,
  Turn,
} from "../shared/types.js";

export { GameError, requireThat, textInput } from "./validation.js";
import { GameError, requireThat, textInput, integer } from "./validation.js";
export function defaultSettings(): GameSettings {
 return { drawMode:"player",name:"蛇结卡组",direction:1,layout:"oval",config:Object.fromEntries(CARDS.map(c=>[c.id,{count:c.ready ? c.defaultCount : 0}])) };
}
export function validateSettings(value: unknown): GameSettings {
 requireThat(value && typeof value === "object","缺少牌局配置");
 const s = value as GameSettings;
 requireThat(!["maxDraws"].some(k=>k in s),"旧版配置需重新确认实体牌数量");
 requireThat(s.drawMode === "player" || s.drawMode === "host","请选择抽牌方式");
 const name=textInput(s.name,"配置名称",32);
 requireThat(s.direction===1 || s.direction===-1,"请选择抽牌方向");
 requireThat(["round","oval","long"].includes(s.layout),"请选择有效桌形");
 requireThat(s.config && typeof s.config==="object","缺少卡组配置");
 const config:CardConfigs={};
 for(const card of CARDS){
  const c=s.config[card.id];
  requireThat(c && Object.keys(c).length===1 && "count" in c,`${card.name}仅接受实体张数`);
  const count=integer(c.count,0,100,`${card.name}张数`);
  requireThat(count===0 || card.ready,`${card.name}机制未定，暂不可启用`);
  config[card.id]={count};
 }
 requireThat(Object.values(config).some(c=>c.count>0),"至少设置一张已定机制牌");
 return {drawMode:s.drawMode,name,config,direction:s.direction,layout:s.layout};
}
export function log(
  room: Room,
  message: string,
  cardId?: string,
  playerId?: string,
  now = Date.now(),
) {
  room.logs.push({ id: randomUUID(), at: now, message, cardId, playerId });
  if (room.logs.length > 500) room.logs.shift();
}
export function createRoom(
  owner: Actor,
  ownerName: string,
  code: string,
  participate: boolean,
  settings: unknown,
  avatar = AVATARS[0],
): Room {
  requireThat(owner.kind === "host", "只有预设主持账号可创建房间");
  requireThat(typeof participate === "boolean", "请选择是否参与游戏");
  const playerId = participate ? randomUUID() : null;
  const now = Date.now();
  const room: Room = {
    schemaVersion: 3,
    links: [], nicknames: {}, cardUses: [], alertCooldowns: {}, alertEvent: null,
    pendingDrawMode: null,
    helpRequests: [],
    id: randomUUID(),
    matchId: randomUUID(),
    code,
    ownerId: owner.id,
    ownerName: textInput(ownerName, "昵称"),
    ownerOnline: false,
    controllerId: owner.id,
    backupId: null,
    hostPlayerId: playerId,
    state: "lobby",
    pauseReason: null,
    accepting: true,
    settings: validateSettings(settings),
    pendingDirection: null,
    players: playerId
      ? [
          {
            id: playerId,
            name: ownerName.trim(),
            avatar: validAvatar(avatar),
            approved: true,
            removed: false,
            online: false,
            joinedAt: now,
          },
        ]
      : [],
    seats: [
      { id: randomUUID(), kind: "host", ...(playerId ? { playerId } : {}) },
    ],
    pendingSeats: null,
    remaining: {},
    turn: null,
    drawCount: 0,
    kingId: null,
    held: [],
    logs: [],
    createdAt: now,
    persistedAt: now,
    endedAt: null,
    endReason: null,
    version: 1,
    appliedRequests: [],
  };
  log(room, "牌局已创建，等待入场与座次安排");
  return room;
}
export function validAvatar(value: unknown): string {
  requireThat(
    typeof value === "string" && AVATARS.includes(value),
    "请选择有效预设头像",
  );
  return value;
}
export function admitted(room: Room) {
  return room.players.filter((p) => p.approved && !p.removed);
}
export function selfPlayer(room: Room, actor: Actor): string | null {
  return actor.id === room.ownerId
    ? room.hostPlayerId
    : admitted(room).some((p) => p.id === actor.id)
      ? actor.id
      : null;
}
export function isControl(room: Room, actor: Actor) {
  return actor.id === room.controllerId;
}
export function assertControl(room: Room, actor: Actor) {
  requireThat(
    isControl(room, actor),
    "此操作仅限当前控场者；原主持可先收回权限",
  );
}
function ownerOnly(room: Room, actor: Actor) {
  requireThat(
    actor.id === room.ownerId && actor.kind === "host",
    "只有原开局主持人可操作",
  );
}
export function playerName(room: Room, id: string) {
  const p = room.players.find((p) => p.id === id);
  requireThat(p, "玩家不存在");
  return p.name;
}
export function order(room: Room, seats = room.seats): string[] {
  return seats.flatMap((s) =>
    s.playerId && admitted(room).some((p) => p.id === s.playerId)
      ? [s.playerId]
      : [],
  );
}
function checkSeats(room: Room, seats: Seat[], complete: boolean) {
  requireThat(seats.length >= 1 && seats.length <= 40, "位置数需为 1–40");
  requireThat(
    seats[0].kind === "host" &&
      seats.filter((s) => s.kind === "host").length === 1,
    "主持人必须位于 1 号",
  );
  requireThat(
    seats[0].playerId ===
      (room.hostPlayerId === null ? undefined : room.hostPlayerId),
    "1 号位必须对应原主持",
  );
  const ids = seats.flatMap((s) => (s.playerId ? [s.playerId] : []));
  requireThat(new Set(ids).size === ids.length, "一名玩家只能绑定一个位置");
  for (const seat of seats) {
    requireThat(
      ["host", "player", "empty", "spectator"].includes(seat.kind),
      "位置类型无效",
    );
    if (seat.kind === "player")
      requireThat(seat.playerId, "参玩位置必须绑定玩家");
    if (seat.kind === "empty" || seat.kind === "spectator")
      requireThat(!seat.playerId, "空位和不参与位置不能绑定玩家");
    if (seat.playerId)
      requireThat(
        admitted(room).some((p) => p.id === seat.playerId),
        "位置绑定了无效或未批准玩家",
      );
  }
  if (complete) {
    const missing = admitted(room).filter((p) => !ids.includes(p.id));
    requireThat(
      missing.length === 0,
      `请先安排座次：${missing.map((p) => p.name).join("、")}`,
    );
  }
}
function planSeats(room: Room, next: Seat[]) {
  checkSeats(room, next, false);
  if (room.state === "lobby") room.seats = next;
  else room.pendingSeats = next;
}
function effectiveSeats(room: Room) {
  return room.pendingSeats === null ? room.seats : room.pendingSeats;
}
function newTurn(room: Room, playerId: string): Turn {
  const seat = room.seats.find((s) => s.playerId === playerId);
  requireThat(seat, "新回合玩家尚未绑定位置");
  return {
    id: randomUUID(),
    playerId,
    anchorSeatId: seat.id,
    phase: "draw",
    choices: {},
  };
}
function nextPlayer(room: Room, from: string, anchorSeatId?: string): string {
  const seats = room.seats;
  const index = seats.findIndex(
    (s) =>
      s.playerId === from ||
      (anchorSeatId !== undefined && s.id === anchorSeatId),
  );
  requireThat(index !== -1, "当前玩家的位置不存在，请检查座次");
  for (let step = 1; step <= seats.length; step++) {
    const s =
      seats[
        (index + room.settings.direction * step + seats.length * 2) %
          seats.length
      ];
    if (s.playerId && admitted(room).some((p) => p.id === s.playerId))
      return s.playerId;
  }
  throw new GameError("没有可继续游戏的参玩者");
}
export function candidates(room:Room){ return CARDS.filter(c=>c.ready && room.remaining[c.id]>0); }
export function selectPhysical(room:Room,random:(max:number)=>number=randomInt):string {
 const cards=candidates(room);
 const sum=cards.reduce((n,c)=>n+room.remaining[c.id],0);
 requireThat(sum>0,"当前没有可抽牌");
 let ticket=random(sum);
 requireThat(Number.isInteger(ticket)&&ticket>=0&&ticket<sum,"随机结果越界");
 for(const c of cards){ticket-=room.remaining[c.id];if(ticket<0)return c.id;}
 throw new GameError("抽牌区间无效");
}
export function finish(room: Room, reason: string, now = Date.now()) {
  room.state = "ended";
  room.endedAt = now;
  room.endReason = reason;
  room.pauseReason = null;
  room.accepting = false;
  room.held=[];room.links=[];room.nicknames={};room.cardUses=[];room.alertCooldowns={};room.alertEvent=null;room.kingId=null;
  if (room.turn) {
    delete room.turn.deadline;
    delete room.turn.remainingMs;
  }
  log(room, `本局结束：${reason}`, undefined, undefined, now);
}
export function pause(room: Room, reason: string, now = Date.now()) {
  if (room.state !== "running") return;
  room.state = "paused";
  room.pauseReason = reason;
  if (room.turn?.deadline !== undefined) {
    room.turn.remainingMs = Math.max(0, room.turn.deadline - now);
    delete room.turn.deadline;
  }
  log(room, `暂停：${reason}`, undefined, undefined, now);
}
function advance(room: Room, now: number) {
  requireThat(room.turn, "当前没有回合");
  const previous = room.turn.playerId;
  if (room.pendingDrawMode !== null) {
    room.settings.drawMode = room.pendingDrawMode;
    room.pendingDrawMode = null;
  }
  if (room.pendingSeats !== null) {
    checkSeats(room, room.pendingSeats, false);
    room.seats = room.pendingSeats;
    room.pendingSeats = null;
    log(room, "新座次已生效", undefined, undefined, now);
  }
  if (room.pendingDirection !== null) {
    room.settings.direction = room.pendingDirection;
    room.pendingDirection = null;
    log(
      room,
      `抽牌方向已改为${room.settings.direction === 1 ? "顺时针" : "逆时针"}`,
      undefined,
      undefined,
      now,
    );
  }
  if (candidates(room).length === 0) {
    finish(room, "没有任何可抽牌", now);
    return;
  }
  const next = nextPlayer(room, previous, room.turn.anchorSeatId);
  room.turn = newTurn(room, next);
  if (!room.players.find((p) => p.id === next)?.online)
    pause(room, `等待${playerName(room, next)}重新连接`, now);
}
export function addApplicant(
  room: Room,
  name: unknown,
  avatar: unknown,
  id: string,
) {
  requireThat(room.state !== "ended" && room.accepting, "本房间暂不接受新玩家");
  requireThat(
    room.players.filter((p) => !p.removed).length < 40 &&
      admitted(room).length < 20,
    "房间人数已满",
  );
  const nickname = textInput(name, "昵称");
  requireThat(
    !room.players.some(
      (p) =>
        !p.removed &&
        p.name.normalize("NFKC").toLocaleLowerCase() ===
          nickname.normalize("NFKC").toLocaleLowerCase(),
    ) &&
      (room.hostPlayerId !== null || nickname !== room.ownerName),
    "昵称已被使用，请换一个",
  );
  room.players.push({
    id,
    name: nickname,
    avatar: validAvatar(avatar),
    approved: false,
    removed: false,
    online: false,
    joinedAt: Date.now(),
  });
  room.version++;
}
export function applyAction(
  original: Room,
  actor: Actor,
  action: RoomAction,
  now = Date.now(),
): Room {
  requireThat(
    typeof action.requestId === "string" &&
      action.requestId.length >= 8 &&
      action.requestId.length <= 100,
    "操作请求标识无效",
  );
  const key = `${actor.id}:${action.requestId}`;
  if (original.appliedRequests.includes(key)) return original;
  requireThat(action.matchId === original.matchId, "牌局已更新，请刷新后重试");
  requireThat(
    actor.id === original.ownerId ||
      admitted(original).some((p) => p.id === actor.id),
    "你还未获得本房间入场权限",
  );
  const room = structuredClone(original);
  const d = action.data === undefined ? {} : action.data;
  requireThat(d && typeof d === "object" && !Array.isArray(d), "操作参数无效");
  if (
    ["draw", "settle", "skip", "task-mode", "nickname", "swap-select", "link", "gate-guess", "guess-answer", "guess-submit", "guess-exclude", "flower-result"].includes(action.type)
  )
    requireThat(
      room.turn && d.turnId === room.turn.id,
      "回合已变化，请查看最新局面后操作",
    );
  const str = (key: string) => textInput(d[key], key, 100);
  const target = () => {
    const id = str("playerId");
    requireThat(
      admitted(room).some((p) => p.id === id),
      "请选择已批准的参玩者",
    );
    return id;
  };
  const control = () => assertControl(room, actor);
  const live = () => requireThat(room.state !== "ended", "牌局已结束");
  const active = () =>
    requireThat(room.state === "running", "牌局尚未开始或已暂停");
  const turn = () => {
    requireThat(room.turn, "当前没有回合");
    return room.turn;
  };
  const taskActor = () => { active(); requireThat(selfPlayer(room,actor)===turn().playerId || isControl(room,actor),"请由本轮玩家或当前控场操作"); };
  switch (action.type) {
    case "task-mode": {
      control();active();
      const t=turn();
      requireThat(t.task?.kind==="gates-mode"||t.task?.kind==="flower-mode","当前任务不需要选择执行方式");
      requireThat(d.mode==="online"||d.mode==="offline","请选择软件执行或线下执行");
      if(d.mode==="offline")delete t.task;
      else if(t.task.kind==="gates-mode")t.task=gates();
      else {t.task={kind:"flower",exploded:false,holderId:null};t.deadline=now+randomInt(10000,30001);}
      break;
    }
    case "nickname": {
      taskActor();const t=turn();requireThat(t.task?.kind==="nickname","当前不需要设置小姐昵称");
      requireThat(typeof d.nickname==="string" && /^[\p{Script=Han}A-Za-z]{1,10}$/u.test(d.nickname),"昵称仅允许1–10个汉字或英文字母");
      grant(room,"c08",t.playerId);room.nicknames[t.playerId]=d.nickname;
      delete t.task;t.effectAt=now;t.autoAdvance=true;t.deadline=now+effectDuration("c08");
      break;
    }
    case "swap-select": {
      taskActor();const t=turn();requireThat(t.task?.kind==="swap","当前不是换座任务");
      requireThat(Array.isArray(d.players)&&d.players.length===2&&new Set(d.players).size===2,"请选择两位不同的参玩者");
      requireThat(d.players.every(id=>typeof id==="string"&&order(room).includes(id)),"请选择已入座的参玩者");
      t.task.players=d.players as string[];break;
    }
    case "link": {
      taskActor();const t=turn();requireThat(t.task?.kind==="link"&&!t.task.done,"当前不是待处理连结任务");
      if(d.operation==="connect")connect(room,t.playerId,target());
      else {requireThat(d.operation==="disconnect","请选择建立或解除连结");const edge=room.links.find(e=>e.id===str("linkId"));requireThat(edge,"连结已变化，请重新选择");room.links=room.links.filter(e=>e.id!==edge.id);}
      t.task.done=true;t.autoAdvance=true;t.deadline=now+1500;break;
    }
    case "gate-guess": {
      taskActor();const t=turn();requireThat(t.task?.kind==="gates","当前不是线上过5关");guessGate(t.task,d.direction);break;
    }
    case "flower-result": {
      control();active();const t=turn();requireThat(t.task?.kind==="flower"&&t.task.exploded,"尚未爆炸，不能登记结果");t.task.holderId=target();break;
    }
    case "guess-answer": {
      taskActor();const t=turn();requireThat(t.task?.kind==="guess"&&!t.task.answerId&&!t.task.cancelled,"答案已提交或本题已取消");
      const answer=target();requireThat(answer!==t.playerId,"请选择另一位玩家作为答案");
      t.task.answerId=answer;t.task.voters=admitted(room).map(p=>p.id).filter(id=>id!==t.playerId);
      if(selfPlayer(room,actor)!==t.playerId){requireThat(d.assist===true,"代填秘密答案需确认退出本题猜测");t.task.helperId=actor.id;const pid=selfPlayer(room,actor);if(pid)t.task.excluded.push(pid);}
      revealIfReady(t.task);break;
    }
    case "guess-submit": {
      active();const t=turn();requireThat(t.task?.kind==="guess"&&t.task.answerId&&!t.task.revealed&&!t.task.cancelled,"当前不能提交猜测");
      const pid=selfPlayer(room,actor);requireThat(pid&&t.task.voters.includes(pid)&&!t.task.excluded.includes(pid),"你不在本题答题名单内");
      requireThat(!Object.hasOwn(t.task.guesses,pid),"每人只可提交一次猜测");t.task.guesses[pid]=target();revealIfReady(t.task);break;
    }
    case "guess-exclude": {
      control();active();const t=turn();requireThat(t.task?.kind==="guess"&&!t.task.revealed&&!t.task.cancelled,"本题已结束");const id=target();
      requireThat(t.task.voters.includes(id)&&!Object.hasOwn(t.task.guesses,id)&&!t.task.excluded.includes(id),"只能排除尚未提交的答题者");t.task.excluded.push(id);revealIfReady(t.task);break;
    }
    case "item-use": {
      active();const held=room.held.find(h=>h.id===str("heldId")&&h.cardId==="c10");requireThat(held,"道具已失效或不存在");
      requireThat(held.playerId===selfPlayer(room,actor),"只能使用自己的单次道具");
      requireThat(!room.cardUses.some(u=>u.heldId===held.id),"这张道具正在等待主持确认");room.cardUses.push({id:randomUUID(),heldId:held.id,playerId:held.playerId,at:now});break;
    }
    case "item-resolve": {
      control();active();const use=room.cardUses.find(u=>u.id===str("useId"));requireThat(use,"该使用请求已处理");requireThat(typeof d.completed==="boolean","请选择完成或拒绝");
      if(d.completed)room.held=room.held.filter(h=>h.id!==use.heldId);room.cardUses=room.cardUses.filter(u=>u.id!==use.id);break;
    }
    case "down": {
      active();const pid=selfPlayer(room,actor);requireThat(pid,"只有参玩者可以使用下头");const identity=identities(room).find(h=>h.playerId===pid&&h.cardId==="c30");requireThat(identity,"你没有有效的下头身份");
      const id=target();requireThat(id!==pid,"请选择其他玩家");requireThat(room.players.find(p=>p.id===id)?.online,"目标已离线，提醒未发送");
      requireThat(!Object.hasOwn(room.alertCooldowns,id)||now-room.alertCooldowns[id]>=60000,"同一目标下头冷却为60秒，请稍后重试");
      room.alertCooldowns[id]=now;room.alertEvent={id:randomUUID(),targetId:id,fromPlayerId:pid,sourcePlayerId:identity.sourcePlayerId,at:now};break;
    }
    case "help": {
      live();
      const pid = selfPlayer(room, actor);
      requireThat(pid, "只有本局参玩者可以求助");
      requireThat(!room.helpRequests.some(h => h.playerId === pid && h.resolvedAt === null), "你的求助已发送，请等待主持人回应");
      const category = d.category === undefined || d.category === "" ? "需要帮助" : textInput(d.category, "求助选项", 24);
      requireThat(["需要帮助", "受到骚扰", "希望停止当前任务", "身体不适", "其他"].includes(category), "求助选项无效");
      const reason = d.reason === undefined ? "" : d.reason;
      requireThat(typeof reason === "string" && reason.trim().length <= 300, "补充原因最多300个字符");
      requireThat(!/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(reason), "补充原因含无效字符");
      room.helpRequests.push({ id: randomUUID(), playerId: pid, category, reason: reason.trim(), at: now, resolvedAt: null });
      break;
    }
    case "help-resolve": {
      requireThat(isControl(room, actor) || actor.id === room.ownerId, "只有当前控场或原主持可处理求助");
      const request = room.helpRequests.find(h => h.id === str("helpId"));
      requireThat(request && request.resolvedAt === null, "求助不存在或已处理");
      request.resolvedAt = now;
      break;
    }
    case "draw-mode": {
      control(); live();
      requireThat(d.mode === "player" || d.mode === "host", "抽牌方式无效");
      if (room.state === "lobby") room.settings.drawMode = d.mode;
      else room.pendingDrawMode = d.mode === room.settings.drawMode ? null : d.mode;
      break;
    }
    case "seat-place": {
      control();
      requireThat(room.state === "lobby", "拖动排座仅限开局前，局内请使用两人换座");
      const pid = target();
      requireThat(pid !== room.hostPlayerId, "原主持固定为1号位");
      const seats = structuredClone(room.seats);
      const previous = seats.find(s => s.playerId === pid);
      const reduced = seats.filter(s => s.playerId !== pid);
      const index = reduced.findIndex(s => s.id === str("afterId"));
      requireThat(index >= 0 && reduced[(index + 1) % reduced.length].id === str("beforeId"), "相邻座位已变化，请重新安排");
      reduced.splice(index + 1, 0, previous === undefined ? { id: randomUUID(), kind: "player", playerId: pid } : previous);
      planSeats(room, reduced);
      break;
    }
    case "approve":
    case "reject": {
      control();
      live();
      const id = str("playerId");
      const p = room.players.find(
        (p) => p.id === id && !p.approved && !p.removed,
      );
      requireThat(p, "申请已处理或不存在");
      if (action.type === "approve") {
        requireThat(admitted(room).length < 20, "最多 20 位参玩者");
        p.approved = true;
        log(room, `${p.name}已获准入场`);
      } else p.removed = true;
      break;
    }
    case "set-accepting":
      control();
      live();
      requireThat(typeof d.accepting === "boolean", "入场开关无效");
      room.accepting = d.accepting;
      break;
    case "settings":
      control();
      requireThat(room.state === "lobby", "开始后不能修改卡组设置");
      room.settings = validateSettings(d.settings);
      break;
    case "direction": {
      control();
      live();
      requireThat(d.direction === 1 || d.direction === -1, "抽牌方向无效");
      if (room.state === "lobby") room.settings.direction = d.direction;
      else {
        room.pendingDirection = d.direction;
        log(room, "新抽牌方向将在本回合结算后生效");
      }
      break;
    }
    case "seat-insert": {
      control();
      live();
      const seats = structuredClone(effectiveSeats(room));
      const after = str("afterId");
      const index = seats.findIndex((s) => s.id === after);
      requireThat(index >= 0, "相邻位置已变化，请重试");
      if (d.beforeId !== undefined)
        requireThat(
          seats[(index + 1) % seats.length].id === d.beforeId,
          "两人已不相邻，请重新选择",
        );
      const kind = str("kind");
      requireThat(
        ["player", "empty", "spectator"].includes(kind),
        "请选择位置类型",
      );
      const pid = kind === "player" ? target() : undefined;
      if (pid)
        requireThat(
          !seats.some((s) => s.playerId === pid),
          "此玩家已有位置，请使用换座",
        );
      seats.splice(index + 1, 0, {
        id: randomUUID(),
        kind: kind as Seat["kind"],
        ...(pid ? { playerId: pid } : {}),
      });
      planSeats(room, seats);
      break;
    }
    case "seat-remove": {
      control();
      live();
      const seats = structuredClone(effectiveSeats(room));
      const index = seats.findIndex((s) => s.id === str("seatId"));
      requireThat(index > 0, "不能删除主持位置");
      requireThat(!seats[index].playerId, "玩家位置请通过换座或移除玩家调整");
      requireThat(
        room.turn?.anchorSeatId !== seats[index].id,
        "请先结算或跳过当前回合，再删除该位置",
      );
      seats.splice(index, 1);
      planSeats(room, seats);
      break;
    }
    case "seat-swap": {
      control();
      live();
      const seats = structuredClone(effectiveSeats(room));
      const a = seats.findIndex((s) => s.id === str("seatA"));
      const b = seats.findIndex((s) => s.id === str("seatB"));
      requireThat(a >= 0 && b >= 0 && a !== b, "请选择两个不同位置");
      const swapTask =
        room.turn?.phase === "task" && room.turn.cardId === "c05";
      if (swapTask) {
        active();
        requireThat(
          seats[a].playerId && seats[b].playerId,
          "强制换座请选择两位参玩者",
        );
        const task=room.turn!.task;
        requireThat(task?.kind==="swap" && task.players.length===2,"请先由抽得者选定两位换座玩家，主持可协助");
        requireThat(task.players.includes(seats[a].playerId!)&&task.players.includes(seats[b].playerId!),"请确认本轮选定的两位玩家换座");
      }
      [seats[a], seats[b]] = [seats[b], seats[a]];
      const host = seats.findIndex((s) => s.kind === "host");
      const rotated = [...seats.slice(host), ...seats.slice(0, host)];
      planSeats(room, rotated);
      log(
        room,
        room.state === "lobby"
          ? "座次已交换"
          : "已确认换座，将在本回合结束后更新",
      );
      if (swapTask) {
        log(
          room,
          "主持已确认现场换座，自动结算本轮",
          "c05",
          room.turn!.playerId,
          now,
        );
        advance(room, now);
      }
      break;
    }
    case "discard-seat-draft":
      control();
      room.pendingSeats = null;
      break;
    case "start": {
      control();
      requireThat(room.state === "lobby", "只能从大厅开始");
      checkSeats(room, room.seats, true);
      requireThat(admitted(room).length >= 2, "至少需要 2 名参玩者");
      requireThat(
        admitted(room).every((p) => p.online),
        "请等待所有参玩者连接，或移除离线玩家",
      );
      room.settings = validateSettings(room.settings);
      const first = room.hostPlayerId === null ? target() : room.hostPlayerId;
      room.remaining = Object.fromEntries(
        CARDS.map((c) => [c.id, room.settings.config[c.id].count]),
      );
      room.state = "running";
      room.turn = newTurn(room, first);
      log(
        room,
        `${playerName(room, first)}首抽，${room.settings.direction === 1 ? "顺时针" : "逆时针"}轮转`,
      );
      break;
    }
    case "draw": {
      active();
      const t = turn();
      requireThat(t.phase === "draw", "本回合已抽牌");
      if (room.settings.drawMode === "host") control();
      else requireThat(selfPlayer(room, actor) === t.playerId, "还未轮到你抽牌");
      if (candidates(room).length === 0) {
        finish(room, "没有任何可抽牌", now);
        break;
      }
      const id = selectPhysical(room);
      const card = cardById(id);
      room.remaining[id]--;
      room.drawCount++;
      t.phase = "task";
      t.cardId = id;
      log(
        room,
        `${playerName(room, t.playerId)}抽到了${card.name}`,
        id,
        t.playerId,
        now,
      );
      if(card.held && id!=="c08")grant(room,id,t.playerId);
      if(id!=="c08")t.effectAt=now;
      if(id==="c08")t.task={kind:"nickname"};
      if(id==="c05")t.task={kind:"swap",players:[]};
      if(id==="c12")t.task={kind:"link",done:false};
      if(id==="c04")t.task={kind:"gates-mode"};
      if(id==="c21")t.task={kind:"flower-mode"};
      if(id==="c32")t.task={kind:"guess",answerId:null,voters:[],guesses:{},excluded:[],helperId:null,revealed:false,cancelled:false};
      if (card.completion === "after_reveal") {
        t.autoAdvance = true;
        t.deadline = now + effectDuration(id);
      }
      break;
    }
    case "settle": {
      control();
      active();
      const t = turn();
      requireThat(t.phase === "task", "本回合尚未抽牌");
      requireThat(!t.autoAdvance, "加冕后自动进入下一位");
      if(t.task){
        requireThat((t.task.kind==="gates"&&t.task.outcome!=="playing") || (t.task.kind==="flower"&&t.task.exploded&&t.task.holderId!==null) || (t.task.kind==="guess"&&(t.task.revealed||t.task.cancelled)),"请先完成本牌的软件操作，或明确取消／跳过");
      }
      requireThat(
        t.cardId !== "c05",
        "请确认两位参玩者现场换座，由系统自动结算",
      );
      const result =
        typeof d.result === "string"
          ? textInput(d.result, "结果", 100)
          : "已完成";
      log(
        room,
        `${playerName(room, t.playerId)}：${result}`,
        t.cardId,
        t.playerId,
        now,
      );
      advance(room, now);
      break;
    }
    case "skip": {
      control();
      requireThat(
        room.state === "running" || room.state === "paused",
        "当前不能跳过",
      );
      const t = turn();
      log(
        room,
        `${playerName(room, t.playerId)}本回合由控场者跳过：${textInput(d.reason, "跳过原因", 100)}`,
        t.cardId,
        t.playerId,
        now,
      );
      room.state = "running";
      room.pauseReason = null;
      advance(room, now);
      break;
    }
    case "pause":
      control();
      active();
      pause(room, "控场者手动暂停", now);
      break;
    case "resume": {
      control();
      requireThat(room.state === "paused", "牌局没有暂停");
      const t = turn();
      requireThat(
        room.players.find((p) => p.id === t.playerId)?.online,
        "请等待当前玩家重连，或明确跳过",
      );
      room.state = "running";
      room.pauseReason = null;
      if (t.remainingMs !== undefined) {
        t.deadline = now + t.remainingMs;
        delete t.remainingMs;
      }
      log(room, "牌局已继续");
      break;
    }
    case "end":
      control();
      live();
      finish(room, "控场者终止", now);
      break;
    case "transfer": {
      ownerOnly(room, actor);
      live();
      const id = target();
      requireThat(
        room.players.find((p) => p.id === id)?.online,
        "目标玩家尚未连接",
      );
      room.controllerId = id;
      log(room, `控场已交给${playerName(room, id)}`);
      break;
    }
    case "reclaim":
      ownerOnly(room, actor);
      live();
      room.controllerId = room.ownerId;
      log(room, "原主持已收回控场权限");
      break;
    case "backup":
      ownerOnly(room, actor);
      live();
      room.backupId = d.playerId === null ? null : target();
      log(
        room,
        room.backupId
          ? `备用控场者：${playerName(room, room.backupId)}`
          : "已取消备用控场者",
      );
      break;
    case "kick": {
      control();
      live();
      const id = target();
      requireThat(id !== room.hostPlayerId, "不能移除原主持");
      requireThat(id !== room.controllerId, "不能移除当前控场者");
      const p = room.players.find((p) => p.id === id)!;
      p.removed = true;
      p.online = false;
      room.seats = room.seats.map((s) =>
        s.playerId === id ? { id: s.id, kind: "empty" as const } : s,
      );
      if (room.pendingSeats)
        room.pendingSeats = room.pendingSeats.map((s) =>
          s.playerId === id ? { id: s.id, kind: "empty" as const } : s,
        );
      room.held = room.held.filter((h) => h.playerId !== id);
      removeIdentityPlayer(room,id);
      const guess=room.turn?.task;
      if(guess?.kind==="guess"){
        if(room.turn!.playerId===id||guess.answerId===id){guess.cancelled=true;guess.revealed=false;guess.answerId=null;guess.guesses={};}
        else {if(guess.voters.includes(id)&&!Object.hasOwn(guess.guesses,id))guess.excluded.push(id);revealIfReady(guess);}
      }
      if (room.kingId === id) room.kingId = null;
      if (room.backupId === id) room.backupId = null;
      log(room, `${p.name}已被移出牌局`);
      if (
        room.turn?.playerId === id ||
        room.turn?.targetId === id ||
        room.turn?.passingPlayerId === id
      )
        pause(room, "本回合相关玩家已离场，请明确跳过本回合", now);
      if (room.state !== "lobby" && admitted(room).length < 2)
        finish(room, "参玩人数不足 2 人", now);
      break;
    }
    case "again": {
      ownerOnly(room, actor);
      requireThat(room.state === "ended", "请先结束本局");
      room.matchId = randomUUID();
      room.state = "lobby";
      room.pauseReason = null;
      room.accepting = true;
      room.turn = null;
      room.drawCount = 0;
      room.kingId = null;
      room.held = [];
      room.links=[];room.nicknames={};room.cardUses=[];room.alertCooldowns={};room.alertEvent=null;
      room.remaining = {};
      room.pendingSeats = null;
      room.pendingDirection = null;
      room.pendingDrawMode = null;
      room.helpRequests = [];
      room.logs = [];
      room.endedAt = null;
      room.endReason = null;
      room.createdAt = now;
      room.controllerId = room.ownerId;
      log(room, "新一局已准备，保留座次和配置");
      break;
    }
    default:
      throw new GameError("不支持的操作");
  }
  room.appliedRequests.push(key);
  if (room.appliedRequests.length > 500) room.appliedRequests.shift();
  room.version++;
  return room;
}
export function connectionChanged(
  original: Room,
  actor: Actor,
  online: boolean,
  now = Date.now(),
): Room {
  const room = structuredClone(original);
  if (actor.id === room.ownerId) {
    room.ownerOnline = online;
    if (room.hostPlayerId) {
      const p = room.players.find((p) => p.id === room.hostPlayerId);
      if (p) p.online = online;
    }
  } else {
    const p = room.players.find((p) => p.id === actor.id && !p.removed);
    if (p) p.online = online;
  }
  if (!online && room.state !== "ended") {
    if (room.controllerId === actor.id) {
      pause(room, "控场者连接中断", now);
      const backup = room.players.find(
        (p) =>
          p.id === room.backupId &&
          p.approved &&
          !p.removed &&
          p.online &&
          p.id !== actor.id,
      );
      if (backup) {
        room.controllerId = backup.id;
        log(room, `${backup.name}已接管，请确认现场后继续`);
      } else if (room.ownerOnline && room.ownerId !== actor.id) {
        room.controllerId = room.ownerId;
        log(room, "原主持恢复控场");
      }
    }
    if (room.turn?.playerId === selfPlayer(room, actor))
      pause(room, "当前玩家连接中断", now);
  }
  room.version++;
  return room;
}
export function tickRoom(original: Room, now = Date.now()): Room {
  if (original.state !== "running" || !original.turn ||
      original.turn.deadline === undefined || now < original.turn.deadline) return original;
  const room = structuredClone(original);
  if(room.turn?.task?.kind==="flower"&&!room.turn.task.exploded){
    room.turn.task.exploded=true;delete room.turn.deadline;
    log(room,"传花已爆炸，请主持登记持物者",room.turn.cardId,room.turn.playerId,now);
  } else if(room.turn?.autoAdvance){
    log(room, "展示完成，进入下一位", room.turn.cardId, room.turn.playerId, now);
    advance(room, now);
  } else return original;
  room.version++;
  return room;
}
export function viewFor(
  room: Room,
  actor: Actor,
):
  | RoomView
  | {
      code: string;
      status: "pending" | "removed";
      name: string;
      avatar: string;
      avatarMatchId: string;
    } {
  const mine = room.players.find((p) => p.id === actor.id);
  if (actor.id !== room.ownerId && (!mine?.approved || mine.removed)) {
    requireThat(mine, "你未申请此房间");
    return {
      code: room.code,
      status: mine.removed ? "removed" : "pending",
      name: mine.name,
      avatar: mine.avatar,
      avatarMatchId: room.matchId,
    };
  }
  const { appliedRequests: _requests, helpRequests: _private, nicknames: _nicknames, alertCooldowns: _cooldowns, alertEvent: _alert, turn: rawTurn, ...view } = structuredClone(room);
  const canControl = isControl(room, actor);
  view.players = view.players.filter(
    (p) => canControl || actor.id === room.ownerId || (p.approved && !p.removed),
  );
  if (!canControl) view.pendingSeats = null;
  const pid=selfPlayer(room,actor);
  let projected:RoomView["turn"]=null;
  if(rawTurn){
    const {task,...rest}=rawTurn;projected=rest;
    if(task?.kind==="gates"){
      const {deck:_deck,discard:_discard,...safe}=task;projected.task=safe;
    } else if(task?.kind==="guess"){
      projected.task={...task,answerId:task.revealed||pid===rawTurn.playerId||task.helperId===actor.id?task.answerId:null,guesses:task.revealed?task.guesses:Object.fromEntries(Object.entries(task.guesses).map(([id,value])=>[id,id===pid?value:"submitted"]))};
    } else if(task)projected.task=task;
    if(task?.kind==="flower"){delete projected.deadline;delete projected.remainingMs;}
  }
  return {
    ...view,
    turn:projected,
    nicknames:canControl||actor.id===room.ownerId ? structuredClone(room.nicknames) : Object.fromEntries(Object.entries(room.nicknames).filter(([id])=>id===pid)),
    identities:identities(room),
    ownAlertCooldowns:identities(room).some(h=>h.playerId===pid&&h.cardId==="c30")?structuredClone(room.alertCooldowns):{},
    helpRequests: canControl || actor.id === room.ownerId ? structuredClone(room.helpRequests) : [],
    backupHelpNotice: actor.id === room.backupId && !canControl && room.helpRequests.some(h => h.resolvedAt === null),
    ownHelpPending: room.helpRequests.some(h => h.playerId === selfPlayer(room, actor) && h.resolvedAt === null),
    selfPlayerId: selfPlayer(room, actor),
    isOwner: actor.id === room.ownerId,
    canControl,
    serverTime: Date.now(),
  };
}

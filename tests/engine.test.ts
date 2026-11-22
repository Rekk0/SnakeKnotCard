import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  addApplicant,
  applyAction,
  candidates,
  connectionChanged,
  createRoom,
  defaultSettings,
  selectPhysical,
  tickRoom,
  viewFor,
} from "../server/engine.js";
import { effectDuration } from "../shared/cards.js";
import type { Actor, Room, RoomAction } from "../shared/types.js";
const owner: Actor = { kind: "host", id: "owner" };
function act(
  room: Room,
  actor: Actor,
  type: string,
  data: Record<string, unknown> = {},
  requestId = randomUUID(),
) {
  return applyAction(room, actor, {
    type,
    data: { ...data, turnId: room.turn?.id },
    requestId,
    matchId: room.matchId,
  });
}
function setup(participate = true) {
  const settings = defaultSettings();
  for (const cfg of Object.values(settings.config)) cfg.count = 0;
  settings.config.c02.count = 100;
  let room = createRoom(
    owner,
    "主持",
    "123456",
    participate,
    settings,
  );
  room = connectionChanged(room, owner, true);
  for (const [id, name] of [
    ["a", "阿川"],
    ["b", "小雨"],
  ]) {
    addApplicant(room, name, "c03", id);
    room = connectionChanged(room, { id, kind: "player" }, true);
    room = act(room, owner, "approve", { playerId: id });
    room = act(room, owner, "seat-insert", {
      afterId: room.seats.at(-1)!.id,
      kind: "player",
      playerId: id,
    });
  }
  return room;
}
test("未批准者只能看到审批状态，不能读牌局或操作", () => {
  const room = setup();
  addApplicant(room, "陌生人", "c03", "x");
  const actor: Actor = { id: "x", kind: "player" };
  const view = viewFor(room, actor);
  assert.equal("status" in view && view.status, "pending");
  assert.equal("players" in view, false);
  assert.throws(() => act(room, actor, "start"), /入场权限/);
});
test("昵称不能重复，空名不能加入", () => {
  const room = setup();
  assert.throws(() => addApplicant(room, "阿川", "c03", "z"), /昵称已被使用/);
  assert.throws(() => addApplicant(room, " ", "c03", "z"), /昵称/);
});
test("开局必须所有参玩者绑定座次，主持参玩固定首抽", () => {
  let room = setup();
  addApplicant(room, "米粒", "c03", "c");
  room = act(room, owner, "approve", { playerId: "c" });
  assert.throws(() => act(room, owner, "start"), /安排座次/);
  let ready = setup();
  ready = act(ready, owner, "start", { playerId: "a" });
  assert.equal(ready.turn!.playerId, ready.hostPlayerId);
});
test("仅控场必须指定有效首抽，顺时针跳过 1 号和空位", () => {
  let room = setup(false);
  room = act(room, owner, "seat-insert", {
    afterId: room.seats[1].id,
    kind: "spectator",
  });
  assert.throws(() => act(room, owner, "start"), /playerId/);
  room = act(room, owner, "start", { playerId: "a" });
  room = act(room, { id: "a", kind: "player" }, "draw");
  room = act(room, owner, "skip", { reason: "测试下一位" });
  assert.equal(room.turn!.playerId, "b");
  room = act(room, owner, "skip", { reason: "测试绕回" });
  assert.equal(room.turn!.playerId, "a");
});
test("逆时针按实际环形顺序，并绕回", () => {
  let room = setup();
  const settings = structuredClone(room.settings);
  settings.direction = -1;
  room = act(room, owner, "settings", { settings });
  room = act(room, owner, "start");
  room = act(room, owner, "draw");
  room = act(room, owner, "skip", { reason: "测试逆时针" });
  assert.equal(room.turn!.playerId, "b");
});
test("非当前玩家不能抽牌，重复请求不多扣次数", () => {
  let room = setup();
  room = act(room, owner, "start");
  assert.throws(
    () => act(room, { id: "a", kind: "player" }, "draw"),
    /还未轮到/,
  );
  const requestId = randomUUID();
  room = act(room, owner, "draw", {}, requestId);
  const snapshot = structuredClone(room);
  room = act(room, owner, "draw", {}, requestId);
  assert.deepEqual(room, snapshot);
  assert.equal(room.drawCount, 1);
});
test("实体牌按剩余张数占区间、抽尽退出且拒绝越界随机数", () => {
  let room = setup();
  room.settings.config.c02.count = 1;
  room.settings.config.c20.count = 3;
  room = act(room, owner, "start");
  assert.equal(selectPhysical(room, () => 0), "c02");
  assert.equal(selectPhysical(room, () => 1), "c20");
  assert.equal(selectPhysical(room, () => 3), "c20");
  room.remaining.c02 = 0;
  assert.deepEqual(candidates(room).map(c => c.id), ["c20"]);
  assert.throws(() => selectPhysical(room, () => 3), /越界/);
  room.remaining.c20 = 0;
  assert.throws(() => selectPhysical(room, () => 0), /没有可抽牌/);
});
test("未定机制牌不可启用，开始后不能改参数", () => {
  let room = setup();
  const settings = defaultSettings();
  settings.config.c06.count = 1;
  assert.throws(() => act(room, owner, "settings", { settings }), /机制未定/);
  room = act(room, owner, "start");
  assert.throws(
    () => act(room, owner, "settings", { settings: defaultSettings() }),
    /开始后/,
  );
});
test("原主持可转交并随时收回，代理没有永久所有权", () => {
  let room = setup();
  room = act(room, owner, "transfer", { playerId: "a" });
  assert.throws(
    () => act(room, owner, "set-accepting", { accepting: false }),
    /当前控场者/,
  );
  assert.throws(
    () => act(room, { id: "a", kind: "player" }, "transfer", { playerId: "b" }),
    /原开局主持人/,
  );
  room = act(room, owner, "reclaim");
  assert.equal(room.controllerId, owner.id);
});
test("当前控场者断线自动暂停并接管，恢复不自动继续", () => {
  let room = setup();
  room = act(room, owner, "backup", { playerId: "a" });
  room = act(room, owner, "start");
  room = connectionChanged(room, owner, false);
  assert.equal(room.state, "paused");
  assert.equal(room.controllerId, "a");
  room = connectionChanged(room, owner, true);
  assert.equal(room.state, "paused");
  room = act(room, owner, "reclaim");
  room = act(room, owner, "resume");
  assert.equal(room.state, "running");
});
test("加冕自动推进冻结恢复且只推进一次", () => {
  let room = setup();
  for (const c of Object.values(room.settings.config)) c.count = 0;
  room.settings.config.c03.count = 3;
  room = act(room, owner, "start");
  const base = Date.now();
  const action = (type: string): RoomAction => ({type,data:{turnId:room.turn?.id},matchId:room.matchId,requestId:randomUUID()});
  room = applyAction(room, owner, action("draw"), base);
  const king = room.turn!.playerId;
  room = applyAction(room, owner, action("pause"), base + 1000);
  assert.equal(room.turn!.remainingMs, effectDuration("c03") - 1000);
  assert.equal(room.turn!.deadline, undefined);
  assert.equal(tickRoom(room, base + 60000), room);
  room = applyAction(room, owner, action("resume"), base + 60000);
  assert.equal(room.turn!.deadline, base + 60000 + effectDuration("c03") - 1000);
  assert.throws(() => act(room, owner, "settle"), /自动/);
  room = tickRoom(room, base + 60001 + effectDuration("c03") - 1000);
  assert.equal(room.turn!.playerId, "a");
  assert.equal(room.kingId, king);
  assert.equal(tickRoom(room, base + 70000), room);
});
test("PK线下执行，仅主持确认，不接受旧手机交互", () => {
  for (const card of ["c22"]) {
    let room = setup();
    for (const c of Object.values(room.settings.config)) c.count = 0;
    room.settings.config[card].count = 3;
    room = act(room, owner, "start");
    room = act(room, owner, "draw");
    assert.equal(room.turn!.deadline, undefined);
    assert.throws(() => act(room, owner, "choice", {choice:"rock"}), /不支持/);
    assert.throws(() => act(room, {id:"a",kind:"player"}, "settle"), /控场/);
    room = act(room, owner, "settle");
    assert.equal(room.turn!.playerId, "a");
  }
});
test("中途绑定与换座延迟到回合边界，牌跟人走", () => {
  let room = setup();
  room = act(room, owner, "start");
  const original = structuredClone(room.seats);
  room = act(room, owner, "seat-swap", {
    seatA: room.seats[1].id,
    seatB: room.seats[2].id,
  });
  assert.deepEqual(room.seats, original);
  assert.ok(room.pendingSeats);
  room = act(room, owner, "skip", { reason: "测试换座" });
  assert.equal(room.turn!.playerId, "b");
  assert.equal(room.pendingSeats, null);
});
test("最后一张牌须完成当前任务才收局", () => {
  let room = setup();
  for (const c of Object.values(room.settings.config)) c.count = 0;
  room.settings.config.c02.count = 1;
  room = act(room, owner, "start");
  room = act(room, owner, "draw");
  assert.equal(room.state, "running");
  room = act(room, owner, "settle", { result: "完成" });
  assert.equal(room.state, "ended");
  assert.match(room.endReason!, /没有任何可抽牌/);
  assert.equal(room.drawCount, 1);
});
test("玩家牌池只有实体张数且看不到配置草稿", () => {
  let room = setup();
  const view = viewFor(room, { id: "a", kind: "player" });
  assert.ok("settings" in view);
  assert.deepEqual(view.settings.config.c02, {count:100});
  assert.equal("maxDraws" in view.settings, false);
  assert.equal(view.pendingSeats, null);
});
test("再来一局保留座次，不保留效果，旧局请求被拒绝", () => {
  let room = setup();
  const oldId = room.matchId;
  room = act(room, owner, "end");
  room = act(room, owner, "again");
  assert.notEqual(room.matchId, oldId);
  assert.equal(room.seats.length, 3);
  assert.equal(room.drawCount, 0);
  assert.throws(
    () =>
      applyAction(room, owner, {
        type: "start",
        requestId: randomUUID(),
        matchId: oldId,
      }),
    /牌局已更新/,
  );
});
test("过期回合的新请求不能结算或跳过最新回合", () => {
  let room = setup();
  room = act(room, owner, "start");
  const oldTurn = room.turn!.id;
  room = act(room, owner, "skip", { reason: "进入下一位" });
  assert.throws(
    () =>
      applyAction(room, owner, {
        type: "skip",
        data: { turnId: oldTurn, reason: "过期请求" },
        matchId: room.matchId,
        requestId: randomUUID(),
      }),
    /回合已变化/,
  );
});
test("移出当前玩家后可以明确跳过，下一位仍正确", () => {
  let room = setup(false);
  addApplicant(room, "第三位", "c03", "c");
  room = act(room, owner, "approve", { playerId: "c" });
  room = connectionChanged(room, { id: "c", kind: "player" }, true);
  room = act(room, owner, "seat-insert", {
    afterId: room.seats.at(-1)!.id,
    kind: "player",
    playerId: "c",
  });
  room = act(room, owner, "start", { playerId: "a" });
  room = act(room, owner, "kick", { playerId: "a" });
  assert.equal(room.state, "paused");
  room = act(room, owner, "skip", { reason: "已离场" });
  assert.equal(room.turn!.playerId, "b");
});
test("局内改方向在结算后生效，不允许借此更改卡组", () => {
  let room = setup();
  room = act(room, owner, "start");
  room = act(room, owner, "direction", { direction: -1 });
  assert.equal(room.settings.direction, 1);
  assert.equal(room.pendingDirection, -1);
  room = act(room, owner, "skip", { reason: "验证新方向" });
  assert.equal(room.settings.direction, -1);
  assert.equal(room.turn!.playerId, "b");
  assert.throws(
    () => act(room, owner, "settings", { settings: defaultSettings() }),
    /开始后/,
  );
});
test("强制换座确认后自动交换位置并结算，不额外点击完成", () => {
  let room = setup();
  for (const c of Object.values(room.settings.config)) c.count = 0;
  room.settings.config.c05.count = 3;
  room = act(room, owner, "start");
  room = act(room, owner, "draw");
  assert.equal(room.turn!.cardId, "c05");
  assert.throws(() => act(room, owner, "settle"), /软件操作|现场换座/);
  assert.throws(() => act(room, owner, "seat-swap", {seatA:room.seats[1].id,seatB:room.seats[2].id}), /先由抽得者选定/);
  room = act(room, owner, "swap-select", {players:["a","b"]});
  room = act(room, owner, "seat-swap", {
    seatA: room.seats[1].id,
    seatB: room.seats[2].id,
  });
  assert.equal(room.pendingSeats, null);
  assert.equal(room.turn!.phase, "draw");
  assert.equal(room.turn!.playerId, "b");
  assert.equal(room.seats[1].playerId, "b");
});

test("抽牌模式边界切换且主持代抽归属玩家", () => {
  let room = setup(false);
  room = act(room, owner, "start", {playerId:"a"});
  room = act(room, owner, "draw-mode", {mode:"host"});
  assert.equal(room.settings.drawMode, "player");
  assert.throws(() => act(room, owner, "draw"), /还未轮到/);
  room = act(room, owner, "skip", {reason:"测试边界"});
  assert.equal(room.settings.drawMode, "host");
  assert.equal(room.turn!.playerId, "b");
  assert.throws(() => act(room, {id:"b",kind:"player"}, "draw"), /控场/);
  room = act(room, owner, "draw");
  assert.equal(room.turn!.playerId, "b");
  room = act(room, owner, "transfer", {playerId:"a"});
  assert.throws(() => act(room, owner, "skip", {reason:"无权限"}), /控场/);
});
test("求助仅当前控场和原主持可见，备用只见提醒", () => {
  let room = setup();
  room = act(room, owner, "backup", {playerId:"b"});
  const logs = structuredClone(room.logs);
  room = act(room, {id:"a",kind:"player"}, "help", {category:"受到骚扰",reason:"私有原因\n第二行"});
  assert.deepEqual(room.logs, logs);
  const get = (actor:Actor) => { const v=viewFor(room,actor); assert.ok("helpRequests" in v); return v; };
  assert.equal(get(owner).helpRequests[0].reason, "私有原因\n第二行");
  assert.equal(get({id:"a",kind:"player"}).helpRequests.length, 0);
  assert.equal(get({id:"a",kind:"player"}).ownHelpPending, true);
  const backup = get({id:"b",kind:"player"});
  assert.equal(backup.backupHelpNotice, true);
  assert.equal(backup.helpRequests.length, 0);
  assert.throws(() => act(room,{id:"b",kind:"player"},"help-resolve",{helpId:room.helpRequests[0].id}), /原主持/);
  assert.throws(() => act(room,{id:"a",kind:"player"},"help"), /已发送/);
  room = act(room, owner, "transfer", {playerId:"b"});
  assert.equal(get({id:"b",kind:"player"}).helpRequests[0].reason, "私有原因\n第二行");
  room = act(room,{id:"b",kind:"player"},"help-resolve",{helpId:room.helpRequests[0].id});
  assert.equal(get({id:"a",kind:"player"}).ownHelpPending, false);
});
test("初始拖动原子排座，主持锚点和玩家唯一", () => {
  let room=setup();
  const hostSeat=room.seats[0].id;
  const b=room.seats[2].id;
  room=act(room,owner,"seat-place",{playerId:"a",afterId:b,beforeId:hostSeat});
  assert.deepEqual(room.seats.map(s=>s.playerId),[room.hostPlayerId,"b","a"]);
  assert.throws(()=>act(room,owner,"seat-place",{playerId:room.hostPlayerId,afterId:b,beforeId:hostSeat}),/固定/);
  assert.throws(()=>act(room,owner,"seat-place",{playerId:"a",afterId:hostSeat,beforeId:"stale"}),/变化/);
  room=act(room,owner,"start");
  assert.throws(()=>act(room,owner,"seat-place",{playerId:"a",afterId:hostSeat,beforeId:b}),/开局前/);
});

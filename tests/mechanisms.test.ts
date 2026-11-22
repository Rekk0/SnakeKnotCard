import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addApplicant, applyAction, connectionChanged, createRoom, defaultSettings, tickRoom, viewFor } from "../server/engine.js";
import { connect, grant, identities, network, removeIdentityPlayer } from "../server/identities.js";
import { gates, guessGate } from "../server/tasks.js";
import { CARDS } from "../shared/cards.js";
import type { Actor, CardTask, PokerCard, Room, RoomView } from "../shared/types.js";

const owner: Actor = { id: "owner", kind: "host" };
const player = (id: string): Actor => ({ id, kind: "player" });
const base = 1_000_000;
function act(room: Room, actor: Actor, type: string, data: Record<string, unknown> = {}, now = base, requestId = randomUUID()) {
  return applyAction(room, actor, { type, data: { ...data, turnId: room.turn?.id }, requestId, matchId: room.matchId }, now);
}
function setup(cardId = "c02") {
  const settings = defaultSettings();
  for (const cfg of Object.values(settings.config)) cfg.count = 0;
  settings.config[cardId].count = 4;
  settings.drawMode = "host";
  let room = createRoom(owner, "主持", "123456", false, settings);
  room = connectionChanged(room, owner, true);
  for (const id of ["a", "b", "c", "d"]) {
    addApplicant(room, `玩家${id}`, "c03", id);
    room = act(room, owner, "approve", { playerId: id });
    room = connectionChanged(room, player(id), true);
    room = act(room, owner, "seat-insert", { afterId: room.seats.at(-1)!.id, kind: "player", playerId: id });
  }
  return act(room, owner, "start", { playerId: "a" });
}
function view(room: Room, actor: Actor): RoomView {
  const result = viewFor(room, actor);
  assert.ok("turn" in result);
  return result;
}
const effective = (room: Room, id: string) => identities(room).filter(h => h.playerId === id).map(h => h.cardId).sort();
const poker = (rank: number, suit = 0): PokerCard => ({ id: suit * 13 + rank - 2, rank, suit });
type Gates = Extract<CardTask, { kind: "gates" }>;
function gateFixture(board: PokerCard[], first: PokerCard[] = []): Gates {
  const reserved = new Set([...board, ...first].map(c => c.id));
  const remaining = Array.from({ length: 52 }, (_, id) => poker(2 + id % 13, Math.floor(id / 13))).filter(c => !reserved.has(c.id));
  return { kind: "gates", board, deck: [...remaining, ...first.toReversed()], discard: [], position: 0, failures: 0, outcome: "playing" };
}

test("30张已定牌开放，未填默认4张、用户已有张数保留且拒绝旧权重结构", () => {
  const settings = defaultSettings();
  assert.equal(CARDS.filter(c => c.ready).length, 30);
  assert.deepEqual(settings.config.c06, { count: 0 });
  assert.deepEqual(settings.config.c11, { count: 0 });
  assert.deepEqual(settings.config.c01, { count: 4 });
  assert.deepEqual(settings.config.c05, { count: 3 });
  assert.throws(() => createRoom(owner, "主持", "123456", false, { ...settings, maxDraws: 50 }), /旧版配置/);
  assert.throws(() => createRoom(owner, "主持", "123456", false, {
    ...settings, config: { ...settings.config, c02: { count: 4, weight: 1 } },
  }), /仅接受实体张数/);
});

test("先到的待批准申请不能越过20人上限，拒绝不部分批准", () => {
  let room = setup();
  for (let i = 0; i < 17; i++) addApplicant(room, `候选${i}`, "c03", `candidate-${i}`);
  for (let i = 0; i < 16; i++) room = act(room, owner, "approve", { playerId: `candidate-${i}` });
  const snapshot = structuredClone(room);
  assert.throws(() => act(room, owner, "approve", { playerId: "candidate-16" }), /20/);
  assert.deepEqual(room, snapshot);
  assert.equal(room.players.filter(p => p.approved && !p.removed).length, 20);
  assert.equal(room.players.find(p => p.id === "candidate-16")!.approved, false);
  assert.throws(() => addApplicant(room, "再来一位", "c03", "extra"), /人数已满/);
});

test("连结链环按来源共享，拆边重算且单次道具不共享", () => {
  const room = setup();
  grant(room, "c03", "a");
  grant(room, "c10", "a");
  connect(room, "a", "b"); connect(room, "b", "c"); connect(room, "c", "a");
  assert.equal(network(room, "a").size, 3);
  assert.equal(identities(room).filter(h => h.cardId === "c03").length, 3);
  assert.deepEqual(effective(room, "b"), ["c03"]);
  room.links = room.links.filter(e => !([e.a, e.b].includes("a")));
  assert.deepEqual(effective(room, "b"), []);
  assert.deepEqual(effective(room, "a"), ["c03", "c10"]);
});

test("冲突连结拒绝且不部分拆链删身份，新同名替换后旧身份不复活", () => {
  const room = setup();
  grant(room, "c13", "a"); grant(room, "c14", "d");
  connect(room, "a", "b"); connect(room, "c", "d");
  const before = structuredClone(room);
  assert.throws(() => connect(room, "b", "c"), /冲突/);
  assert.deepEqual(room, before);
  grant(room, "c13", "c");
  assert.deepEqual(effective(room, "a"), []);
  removeIdentityPlayer(room, "c");
  assert.deepEqual(effective(room, "a"), []);
});

test("抽相反S/M原子拆本人所有边，保留别人的实体身份及剩余网络", () => {
  let room = setup("c14");
  grant(room, "c13", "b"); grant(room, "c14", "d");
  connect(room, "a", "b"); connect(room, "b", "c");
  room = act(room, owner, "draw");
  assert.deepEqual(effective(room, "a"), ["c14"]);
  assert.deepEqual(effective(room, "b"), ["c13"]);
  assert.deepEqual(effective(room, "c"), ["c13"]);
  assert.deepEqual(effective(room, "d"), []);
  assert.equal(room.links.length, 1);
  assert.equal(room.links[0].a, "b");
  assert.equal(room.links[0].b, "c");
});

test("连结动作由抽得者执行，非当事玩家不可操作，冲突失败保留整个快照", () => {
  let room = setup("c12");
  grant(room, "c13", "a"); grant(room, "c14", "c");
  room = act(room, owner, "draw");
  assert.throws(() => act(room, player("b"), "link", { operation: "connect", playerId: "d" }), /本轮玩家/);
  const snapshot = structuredClone(room);
  assert.throws(() => act(room, player("a"), "link", { operation: "connect", playerId: "c" }), /冲突/);
  assert.deepEqual(room, snapshot);
  room = act(room, player("a"), "link", { operation: "connect", playerId: "b" });
  assert.deepEqual(effective(room, "b"), ["c13"]);
});

test("小姐提交前跳过保留旧来源，提交后跳过保留新来源", () => {
  let room = setup("c08");
  grant(room, "c08", "b"); room.nicknames.b = "旧昵称";
  room = act(room, owner, "draw");
  assert.equal(room.held.find(h => h.cardId === "c08")?.playerId, "b");
  room = act(room, owner, "skip", { reason: "本人尚未提交" });
  assert.deepEqual(room.nicknames, { b: "旧昵称" });
  room = act(room, owner, "draw");
  room = act(room, player("b"), "nickname", { nickname: "Rose小姐" });
  room = act(room, owner, "skip", { reason: "跳过剩余宣告" });
  assert.deepEqual(room.nicknames, { b: "Rose小姐" });
});

test("小姐仅汉英1至10字，私密昵称不向共享者和备用泄露", () => {
  let room = setup("c08");
  room = act(room, owner, "backup", { playerId: "b" });
  connect(room, "a", "b");
  room = act(room, owner, "draw");
  for (const nickname of ["", "A1", "小姐 ", "小姐!", "💋", "abcdefghijk"]) {
    assert.throws(() => act(room, player("a"), "nickname", { nickname }), /1–10/);
  }
  assert.throws(() => act(room, player("c"), "nickname", { nickname: "Rose" }), /本轮玩家/);
  room = act(room, player("a"), "nickname", { nickname: "玫瑰Rose" });
  assert.deepEqual(view(room, player("a")).nicknames, { a: "玫瑰Rose" });
  assert.deepEqual(view(room, owner).nicknames, { a: "玫瑰Rose" });
  assert.deepEqual(view(room, player("b")).nicknames, {});
  assert.ok(effective(room, "b").includes("c08"));
  assert.ok(!JSON.stringify(room.logs).includes("玫瑰Rose"));
  room = act(room, owner, "transfer", { playerId: "c" });
  assert.deepEqual(view(room, player("c")).nicknames, { a: "玫瑰Rose" });
  assert.deepEqual(view(room, owner).nicknames, { a: "玫瑰Rose" });
});

test("过5关A高2低，同点失败，新牌替换且其他格保留", () => {
  const task = gateFixture([poker(13), poker(14), poker(7), poker(8), poker(9)], [poker(14, 1), poker(2), poker(7, 1)]);
  guessGate(task, "higher"); assert.equal(task.position, 1);
  guessGate(task, "lower"); assert.equal(task.position, 2);
  const otherCells = task.board.filter((_, i) => i !== 2);
  guessGate(task, "higher");
  assert.equal(task.failures, 1); assert.equal(task.position, 0);
  assert.equal(task.board[2].id, poker(7, 1).id);
  assert.deepEqual(task.board.filter((_, i) => i !== 2), otherCells);
});

test("过5关第5错停止重试，不能多算失败或丢失五格", () => {
  const task = gates();
  for (let failure = 1; failure <= 5; failure++) {
    const next = task.deck.at(-1)!;
    const direction = next.rank > task.board[0].rank ? "lower" : "higher";
    guessGate(task, direction);
    assert.equal(task.failures, failure);
    assert.equal(task.position, 0);
    assert.equal(task.board[0].id, next.id);
  }
  assert.equal(task.outcome, "lost");
  const before = structuredClone(task);
  assert.throws(() => guessGate(task, "higher"), /已经结束/);
  assert.deepEqual(task, before);
});

test("五连对成功仍保留此前罚次，并等待主持结算", () => {
  let room = act(setup("c04"), owner, "draw");
  room = act(room, owner, "task-mode", { mode: "online" });
  const task = gateFixture([2, 3, 4, 5, 6].map(rank => poker(rank)), [poker(14), poker(14, 1), poker(14, 2), poker(14, 3), poker(13, 3)]);
  task.failures = 2;
  room.turn!.task = task;
  for (let position = 0; position < 5; position++) room = act(room, player("a"), "gate-guess", { direction: "higher" });
  assert.ok(room.turn!.task?.kind === "gates");
  assert.equal(room.turn!.task.outcome, "won"); assert.equal(room.turn!.task.failures, 2);
  assert.equal(room.turn!.playerId, "a");
  room = act(room, owner, "settle");
  assert.equal(room.turn!.playerId, "b");
});

test("扑克牌堆耗尽只洗弃牌，五格与既有罚次保留且52张不重不丢", () => {
  const task = gates();
  task.discard = task.deck; task.deck = []; task.position = 1; task.failures = 2;
  const unchanged = task.board.filter((_, i) => i !== 1);
  guessGate(task, "higher");
  assert.deepEqual(task.board.filter((_, i) => i !== 1), unchanged);
  assert.ok(task.failures === 2 || task.failures === 3);
  const ids = [...task.board, ...task.deck, ...task.discard].map(c => c.id);
  assert.equal(ids.length, 52); assert.equal(new Set(ids).size, 52);
});

test("过5关所有角色只能看五格和结果，不能读未来牌序或弃牌", () => {
  let room = act(setup("c04"), owner, "draw");
  assert.throws(() => act(room, player("a"), "task-mode", { mode: "online" }), /当前控场/);
  room = act(room, owner, "task-mode", { mode: "online" });
  for (const actor of [owner, player("a"), player("b")]) {
    const task = view(room, actor).turn!.task!;
    assert.equal(task.kind, "gates");
    assert.equal("deck" in task, false); assert.equal("discard" in task, false);
  }
  assert.throws(() => act(room, owner, "settle"), /软件操作/);
});

test("传花隐藏随机爆点，暂停冻结，爆炸后仍须登记并主持结算", () => {
  let room = act(setup("c21"), owner, "draw");
  room = act(room, owner, "task-mode", { mode: "online" }, base);
  const deadline = room.turn!.deadline!;
  assert.ok(deadline >= base + 10000 && deadline <= base + 30000);
  for (const actor of [owner, player("a"), player("b")]) {
    assert.equal(view(room, actor).turn!.deadline, undefined);
    assert.equal(view(room, actor).turn!.remainingMs, undefined);
  }
  assert.equal(tickRoom(room, deadline - 1), room);
  room = act(room, owner, "pause", {}, base + 1000);
  assert.equal(tickRoom(room, deadline + 100000), room);
  assert.equal(view(room, owner).turn!.remainingMs, undefined);
  room = act(room, owner, "resume", {}, base + 100000);
  assert.equal(room.turn!.deadline, deadline + 99000);
  room = tickRoom(room, room.turn!.deadline!);
  assert.ok(room.turn!.task?.kind === "flower" && room.turn!.task.exploded);
  assert.equal(room.turn!.playerId, "a");
  assert.throws(() => act(room, owner, "settle"), /软件操作/);
  room = act(room, owner, "flower-result", { playerId: "c" });
  room = act(room, owner, "settle");
  assert.equal(room.turn!.playerId, "b");
});

test("传花自计完全无线上的计时、引爆及结果输入", () => {
  let room = act(setup("c21"), owner, "draw");
  room = act(room, owner, "task-mode", { mode: "offline" });
  assert.equal(room.turn!.task, undefined); assert.equal(room.turn!.deadline, undefined);
  assert.equal(tickRoom(room, base + 999999), room);
  assert.throws(() => act(room, owner, "flower-result", { playerId: "b" }), /尚未爆炸/);
  room = act(room, owner, "settle");
  assert.equal(room.turn!.playerId, "b");
});

test("天菜名单锁定、每人一次，全交才揭晓且主持不能偷窥", () => {
  let room = act(setup("c32"), owner, "draw");
  room = act(room, player("a"), "guess-answer", { playerId: "c" });
  assert.equal(view(room, owner).turn!.task?.kind, "guess");
  const hidden = view(room, owner).turn!.task;
  assert.ok(hidden?.kind === "guess"); assert.equal(hidden.answerId, null);
  room = act(room, player("b"), "guess-submit", { playerId: "d" });
  assert.throws(() => act(room, player("b"), "guess-submit", { playerId: "c" }), /一次/);
  const publicTask = view(room, owner).turn!.task;
  assert.ok(publicTask?.kind === "guess"); assert.deepEqual(publicTask.guesses, { b: "submitted" });
  addApplicant(room, "晚入者", "c03", "late"); room = act(room, owner, "approve", { playerId: "late" });
  assert.throws(() => act(room, player("late"), "guess-submit", { playerId: "c" }), /名单/);
  room = act(room, player("c"), "guess-submit", { playerId: "c" });
  assert.ok(room.turn!.task?.kind === "guess"); assert.equal(room.turn!.task.revealed, false);
  room = act(room, player("d"), "guess-submit", { playerId: "c" });
  const revealed = view(room, owner).turn!.task;
  assert.ok(revealed?.kind === "guess"); assert.equal(revealed.revealed, true);
  assert.equal(revealed.answerId, "c"); assert.deepEqual(revealed.guesses, { b: "d", c: "c", d: "c" });
});

test("天菜主持辅助须显式退出猜测，未提交断线者等待或明确排除", () => {
  let room = setup("c32");
  room = act(room, owner, "transfer", { playerId: "b" });
  room = act(room, player("b"), "draw");
  assert.throws(() => act(room, player("b"), "guess-answer", { playerId: "d" }), /退出本题/);
  room = act(room, player("b"), "guess-answer", { playerId: "d", assist: true });
  assert.throws(() => act(room, player("b"), "guess-submit", { playerId: "d" }), /名单/);
  room = act(room, player("d"), "guess-submit", { playerId: "d" });
  room = connectionChanged(room, player("c"), false);
  assert.ok(room.turn!.task?.kind === "guess"); assert.equal(room.turn!.task.revealed, false);
  assert.throws(() => act(room, player("b"), "guess-exclude", { playerId: "d" }), /尚未提交/);
  room = act(room, player("b"), "guess-exclude", { playerId: "c" });
  assert.ok(room.turn!.task?.kind === "guess"); assert.equal(room.turn!.task.revealed, true);
});

test("天菜移出出题者或答案目标取消本题，不将未交者算错", () => {
  for (const removed of ["a", "c"]) {
    let room = act(setup("c32"), owner, "draw");
    room = act(room, player("a"), "guess-answer", { playerId: "c" });
    room = act(room, player("b"), "guess-submit", { playerId: "d" });
    room = act(room, owner, "kick", { playerId: removed });
    assert.ok(room.turn!.task?.kind === "guess");
    assert.equal(room.turn!.task.cancelled, true); assert.equal(room.turn!.task.revealed, false);
    assert.equal(room.turn!.task.answerId, null); assert.deepEqual(room.turn!.task.guesses, {});
  }
});

test("下头共享可用、同一目标跨发起者60秒冷却及重复请求去重", () => {
  let room = setup();
  grant(room, "c30", "a"); connect(room, "a", "b");
  const request = randomUUID();
  room = act(room, player("b"), "down", { playerId: "c" }, base, request);
  assert.equal(room.alertEvent!.fromPlayerId, "b"); assert.equal(room.alertEvent!.sourcePlayerId, "a");
  const snapshot = structuredClone(room);
  assert.equal(act(room, player("b"), "down", { playerId: "c" }, base + 100, request), room);
  assert.deepEqual(room, snapshot);
  assert.throws(() => act(room, player("a"), "down", { playerId: "c" }, base + 59999), /60秒/);
  assert.throws(() => act(room, player("d"), "down", { playerId: "c" }, base + 60000), /没有有效/);
  room = act(room, player("a"), "down", { playerId: "c" }, base + 60000);
  assert.equal(room.alertEvent!.fromPlayerId, "a");
  assert.equal("alertEvent" in view(room, player("d")), false);
  assert.equal("alertCooldowns" in view(room, player("d")), false);
  room = connectionChanged(room, player("c"), false);
  assert.throws(() => act(room, player("b"), "down", { playerId: "c" }, base + 120000), /已离线/);
});

test("代劳道具只由持有者请求、拒绝不核销、同意完成只核销一张", () => {
  let room = setup(); grant(room, "c10", "a"); grant(room, "c10", "a"); connect(room, "a", "b");
  const heldId = room.held[0].id;
  assert.throws(() => act(room, player("b"), "item-use", { heldId }), /自己/);
  assert.throws(() => act(room, owner, "item-use", { heldId }), /自己|持有人/);
  room = act(room, player("a"), "item-use", { heldId });
  assert.throws(() => act(room, player("a"), "item-use", { heldId }), /等待主持/);
  room = act(room, owner, "item-resolve", { useId: room.cardUses[0].id, completed: false });
  assert.equal(room.held.length, 2); assert.equal(room.cardUses.length, 0);
  room = act(room, player("a"), "item-use", { heldId });
  room = act(room, owner, "item-resolve", { useId: room.cardUses[0].id, completed: true });
  assert.equal(room.held.length, 1); assert.equal(room.cardUses.length, 0);
});

test("终止和再开清除身份来源、连结、私有昵称、道具请求与下头冷却", () => {
  let room = setup(); grant(room, "c08", "a"); room.nicknames.a = "Rose";
  grant(room, "c10", "a"); grant(room, "c30", "b"); connect(room, "a", "b");
  room = act(room, player("a"), "item-use", { heldId: room.held.find(h => h.cardId === "c10")!.id });
  room = act(room, player("b"), "down", { playerId: "c" });
  room = act(room, owner, "end");
  assert.deepEqual(room.held, []); assert.deepEqual(room.links, []); assert.deepEqual(room.nicknames, {});
  assert.deepEqual(room.cardUses, []); assert.deepEqual(room.alertCooldowns, {}); assert.equal(room.alertEvent, null);
  room = act(room, owner, "again");
  assert.deepEqual(room.held, []); assert.deepEqual(room.links, []); assert.deepEqual(room.nicknames, {});
});

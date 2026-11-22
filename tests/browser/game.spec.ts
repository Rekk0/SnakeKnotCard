import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "./fixtures";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { Session, GameSettings, RoomView } from "../../shared/types";
import { CARDS } from "../../shared/cards";
import { LEGAL_VERSION, OPERATOR, CONTACT } from "../../shared/legal";

async function json<T>(
  request: APIRequestContext,
  path: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const r =
    data === undefined
      ? await request.get(path, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      : await request.post(path, {
          data,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
const ownersToClean: Session[] = [];
test("第三版：下头提醒在桌图弹窗顶层可见可关闭，冷却60秒且不广播给旁人",async({browser,request})=>{
 const game=await populated(request,"c30");const target=await pageAs(browser,game.guests[0].session,game.code);
 const unrelated:unknown[]=[];game.guests[1].client.socket.on("down-alert",e=>unrelated.push(e));
 try{
  await game.h.action("start");await game.h.action("draw");
  await target.page.getByRole("button",{name:"关闭本机动效",exact:true}).click();
  await target.page.getByRole("button",{name:"桌图",exact:true}).click();
  await game.h.action("down",{playerId:game.guests[0].session.actor.id});
  const notice=target.page.locator(".down-notice");await expect(notice).toBeVisible();await expect(notice).toContainText("文字提醒");
  expect(await notice.evaluate(e=>e.parentElement?.tagName)).toBe("DIALOG");
  await target.page.getByRole("button",{name:"知道了",exact:true}).click();await expect(notice).toHaveCount(0);
  await expect(game.h.action("down",{playerId:game.guests[0].session.actor.id})).rejects.toThrow(/60秒/);
  expect(unrelated).toEqual([]);await expect(target.page.getByRole("dialog")).toBeVisible();
 }finally{await target.context.close();await game.close();}
});

test("第三版：软件传花真实随机爆炸后登记，最后一张结算不会被任务弹窗遮挡",async({browser,request})=>{
 test.setTimeout(65000);const game=await populated(request,"c21");const ui=await pageAs(browser,game.owner,game.code);
 try{
  const settings=game.h.view.settings;settings.config.c21.count=1;await game.h.action("settings",{settings});await game.h.action("start");
  await ui.page.getByRole("button",{name:"抽取你的牌",exact:true}).click();await ui.page.getByRole("button",{name:"关闭本机动效",exact:true}).click();
  await ui.page.getByRole("button",{name:"使用软件计时",exact:true}).click();
  expect(game.h.view.turn!.deadline).toBeUndefined();expect(game.h.view.turn!.remainingMs).toBeUndefined();
  await expect(ui.page.getByText("正在传花",{exact:true})).toBeVisible();
  await ui.page.getByRole("button",{name:"暂停牌局",exact:true}).click();await expect(ui.page.getByRole("heading",{name:"牌局已暂停"})).toBeVisible();
  await ui.page.getByRole("button",{name:"继续牌局",exact:true}).click();await ui.page.getByRole("button",{name:"打开本牌操作",exact:true}).click();
  await expect(ui.page.getByText("爆炸！",{exact:true})).toBeVisible({timeout:35000});
  await ui.page.getByRole("button",{name:"新机制玩家1",exact:true}).click();await ui.page.getByRole("button",{name:"登记持物者",exact:true}).click();
  await ui.page.getByRole("button",{name:"确认结果，下一位",exact:true}).click();await expect(ui.page.getByRole("heading",{name:"这一局，落幕。"})).toBeVisible();
  await expect(ui.page.locator(".card-task")).toHaveCount(0);
 }finally{await ui.context.close();await game.close();}
});
test("第三版：两种抽牌方式逐张执行全部30种牌，最终抽尽",async({request})=>{
 test.setTimeout(180000);
 for(const mode of ["player","host"] as const){
  const game=await populated(request,"c02",false);
  // 一个客户端收到ACK不代表其他Socket已消费广播；逐牌验收先同步视图版本。
  const clients=[game.h,...game.guests.map(g=>g.client)];
  for(const client of clients){const action=client.action.bind(client);client.action=async(type,data={})=>{await action(type,data);const version=client.view.version;await expect.poll(()=>clients.every(c=>c.view.version>=version)).toBe(true);};}
  try{
   const settings=await json<GameSettings>(request,"/api/default-settings");settings.drawMode=mode;
   for(const card of CARDS)settings.config[card.id].count=card.ready?1:0;
   await game.h.action("settings",{settings});await game.h.action("start",{playerId:game.guests[0].session.actor.id});
   const seen=new Set<string>();
   while(game.h.view.state!=="ended"){
    const player=game.guests.find(g=>g.session.actor.id===game.h.view.turn!.playerId)!.client;
    await (mode==="host"?game.h:player).action("draw");
    const before=game.h.view.turn!;seen.add(before.cardId!);
    expect(game.h.view.remaining[before.cardId!]).toBe(0);
    const kind=before.task?.kind;
    if(kind==="nickname")await player.action("nickname",{nickname:"测试Miss"});
    if(kind==="gates-mode"){
      await game.h.action("task-mode",{mode:"online"});
      for(let i=0;i<30;i++){const task=game.h.view.turn!.task;expect(task?.kind).toBe("gates");if(task?.kind!=="gates"||task.outcome!=="playing")break;await player.action("gate-guess",{direction:"lower"});}
      expect(game.h.view.turn!.task?.kind==="gates"&&game.h.view.turn!.task.outcome!=="playing").toBeTruthy();
    }
    if(kind==="flower-mode")await game.h.action("task-mode",{mode:"offline"});
    if(kind==="swap"){
      const ids=game.guests.slice(0,2).map(g=>g.session.actor.id);await player.action("swap-select",{players:ids});
      await game.h.action("seat-swap",{seatA:game.h.view.seats.find(s=>s.playerId===ids[0])!.id,seatB:game.h.view.seats.find(s=>s.playerId===ids[1])!.id});continue;
    }
    if(kind==="link"){
      const ids=game.guests.map(g=>g.session.actor.id);let made=false;
      for(const id of ids.filter(id=>id!==before.playerId)){
        try{await player.action("link",{operation:"connect",playerId:id});made=true;break;}catch(e){expect((e as Error).message).toMatch(/S与M身份冲突/);}
      }
      if(!made){await game.h.action("skip",{reason:"验收：所有对象均存在明确身份冲突"});continue;}
    }
    if(kind==="guess"){
      const answer=game.guests.find(g=>g.session.actor.id!==before.playerId)!.session.actor.id;
      await player.action("guess-answer",{playerId:answer});
      const task=game.h.view.turn!.task;if(task?.kind!=="guess")throw new Error("天菜任务丢失");
      for(const voter of task.voters)await game.guests.find(g=>g.session.actor.id===voter)!.client.action("guess-submit",{playerId:answer});
      expect(game.h.view.turn!.task?.kind==="guess"&&game.h.view.turn!.task.revealed).toBeTruthy();
    }
    if(game.h.view.turn?.autoAdvance)await expect.poll(()=>game.h.view.state==="ended"||game.h.view.turn?.id!==before.id,{timeout:7000}).toBeTruthy();
    else await game.h.action("settle",{result:"验收：已执行对应软件任务或现场流程"});
   }
   expect(seen.size).toBe(30);expect(game.h.view.drawCount).toBe(30);expect(Object.values(game.h.view.remaining).every(n=>n===0)).toBeTruthy();
  }finally{await game.close();}
 }
});

test("第三版：昵称与过5关手机任务可操作，桌图和列表多尺寸不挤压",async({browser,request})=>{
 test.setTimeout(90000);const issues:string[]=[];
 for(const id of ["c08","c04","c12","c05","c32"]){
  const game=await populated(request,id,true,"qa-host-2");const ui=await pageAs(browser,game.owner,game.code);
  try{
   await game.h.action("start");await ui.page.getByRole("button",{name:"抽取你的牌",exact:true}).click();
   const effect=ui.page.getByRole("button",{name:"关闭本机动效",exact:true});
   if(id!=="c08")await effect.click();
   const task=ui.page.getByRole("dialog");await expect(task).toBeVisible();
   for(const size of [...mobileAuditSizes,{width:768,height:1024},{width:1280,height:590}]){await ui.page.setViewportSize(size);await auditMobileLayout(ui.page,`${id}-${size.width}任务`,issues);}
   await ui.page.setViewportSize({width:390,height:844});
   if(id==="c08"){
     await ui.page.getByLabel("设置你的小姐昵称").fill("Miss测试");await ui.page.getByRole("button",{name:"确认昵称并登场"}).click();
     await expect(ui.page.getByRole("button",{name:"关闭本机动效",exact:true})).toBeVisible();
     await expect(ui.page.getByRole("heading",{name:/已决心下海/})).toBeVisible();
     expect(game.guests[0].client.view.nicknames).toEqual({});expect(game.h.view.nicknames[game.h.view.hostPlayerId!]).toBe("Miss测试");
   }
   if(id==="c04"){
     await ui.page.getByRole("button",{name:"使用软件执行",exact:true}).click();await expect(ui.page.locator(".poker-card")).toHaveCount(5);
     for(let i=0;i<30;i++){const t=game.h.view.turn!.task;if(t?.kind!=="gates"||t.outcome!=="playing")break;await ui.page.getByRole("button",{name:"更小",exact:true}).click();}
     const t=game.h.view.turn!.task;expect(t?.kind==="gates"&&t.outcome!=="playing").toBeTruthy();await expect(ui.page.getByText(/本次累计受罚/)).toBeVisible();
   }
   if(id==="c12"){
     await ui.page.getByRole("button",{name:"新机制玩家1",exact:true}).click();await ui.page.getByRole("button",{name:"与选中玩家连结"}).click();await expect.poll(()=>game.h.view.links.length).toBe(1);
   }
   if(id==="c05"){
     await ui.page.getByRole("button",{name:"新机制玩家1",exact:true}).click();await ui.page.getByRole("button",{name:"新机制玩家2",exact:true}).click();
     await ui.page.getByRole("button",{name:"提交这两位玩家"}).click();await ui.page.getByRole("button",{name:"已实际换座，确认更新位置"}).click();await expect.poll(()=>game.h.view.turn?.phase).toBe("draw");
   }
   if(id==="c32"){
     await ui.page.getByRole("button",{name:"新机制玩家1",exact:true}).click();await ui.page.getByRole("button",{name:"秘密提交答案",exact:true}).click();
     expect(game.guests[0].client.view.turn!.task?.kind==="guess"&&game.guests[0].client.view.turn!.task.answerId===null).toBeTruthy();
     for(const g of game.guests)await g.client.action("guess-submit",{playerId:game.guests[0].session.actor.id});
     await expect(ui.page.getByRole("heading",{name:"答案：新机制玩家1"})).toBeVisible();
   }
   await ui.page.screenshot({path:`docs/visuals/v3-task-${id}.png`});
  }finally{await ui.context.close();await game.close();}
 }
 expect(issues).toEqual([]);
});
async function populated(request:APIRequestContext, cardId:string, participate=true,login="qa-host"){
 const owner=await host(request,login);const {code}=await create(request,owner,cardId,participate);const h=await socketAs(owner,code);
 const guests:{session:Session;client:Awaited<ReturnType<typeof socketAs>>}[]=[];
 for(let i=0;i<3;i++){
  const session=await json<Session>(request,"/api/join",undefined,{code,name:`新机制玩家${i+1}`,avatar:"c07"});
  await h.action("approve",{playerId:session.actor.id});const client=await socketAs(session,code);guests.push({session,client});
  await h.action("seat-insert",{afterId:h.view.seats.at(-1)!.id,kind:"player",playerId:session.actor.id});
 }
 return {owner,code,h,guests,close:async()=>{await endRoom(h);for(const g of guests)g.client.socket.disconnect();}};
}
const mobileAuditSizes=[{width:320,height:568},{width:360,height:740},{width:390,height:844},{width:430,height:932},{width:667,height:375}];
async function auditMobileLayout(page:Page,label:string,issues:string[]) {
  const dialog=page.getByRole("dialog").last();
  if(await dialog.count()) await dialog.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
  const problems=await page.evaluate(()=>{
    const result:string[]=[];
    if(document.documentElement.scrollWidth>innerWidth+1) {
      const outside=[...document.querySelectorAll<HTMLElement>("body *")].filter(e=>{
        const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&r.left>=0;
      }).slice(0,8).map(e=>`${e.tagName}.${e.className}`);
      result.push(`页面宽${document.documentElement.scrollWidth}>${innerWidth} ${outside.join(",")}`);
    }
    for(const e of document.querySelectorAll<HTMLElement>("dialog[open],.sheet-heading,.sheet-body,.room-header,.applicant-row,.template-row,.config-card-head,.config-inputs,.field-pair,.seat-player-chip,.seat-order-row,.help-item,.history-list > div,.player-detail-header,.settings-summary,.catalog-caption,.v3-effect__copy")) {
      const r=e.getBoundingClientRect();
      if(r.width===0 || r.height===0 || e.closest("dialog:not([open])"))continue;
      if(e.scrollWidth>e.clientWidth+1) result.push(`${e.className||e.tagName} 内容宽${e.scrollWidth}>${e.clientWidth}`);
      if(e.matches("dialog[open]")&&(r.left< -1||r.right>innerWidth+1||r.top< -1||r.bottom>innerHeight+1)) result.push(`弹窗越界 ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      if(e.matches(".v3-effect__copy")&&(r.left< -1||r.right>innerWidth+1||r.top< -1||r.bottom>innerHeight+1)) result.push("长昵称揭牌提示越界");
    }
    const top=document.querySelector<HTMLDialogElement>("dialog[open]:last-of-type");
    for(const button of document.querySelectorAll<HTMLElement>(".template-save > button")) {
      if(button.getBoundingClientRect().height>64) result.push("模板保存按钮被挤成多行");
    }
    const header=document.querySelector<HTMLElement>(".room-header");
    if(header) {
      const bounds=header.getBoundingClientRect();
      for(const child of header.children) if(child.getBoundingClientRect().bottom>bounds.bottom+1) result.push("顶部操作换行越出标题栏");
    }
    if(top) {
      const close=top.querySelector<HTMLElement>(".sheet-heading button,.effect-close")!.getBoundingClientRect();
      if(close.width<40||close.right>innerWidth+1) result.push("关闭按钮被挤压或越界");
    }
    return result;
  });
  issues.push(...problems.map(p=>`${label}: ${p}`));
}
async function closeAuditDialog(page:Page) {
  await page.getByRole("dialog").last().getByRole("button",{name:"关闭",exact:true}).click();
}
const hostSessions=new Map<string,Session>();
async function host(request: APIRequestContext, login = "qa-host") {
  let s=hostSessions.get(login);
  if(!s){s=await json<Session>(request, "/api/login", undefined, {
    login,
    password: "local-qa-password-2026",
  });hostSessions.set(login,s);}
  ownersToClean.push(s);
  return s;
}
test.afterEach(async ({ request }) => {
  for (const owner of ownersToClean.splice(0)) {
    const active = await json<{ code: string | null }>(
      request,
      "/api/host/room",
      owner.token,
    );
    if (active.code) {
      const client = await socketAs(owner, active.code);
      await endRoom(client);
    }
  }
});
async function create(
  request: APIRequestContext,
  session: Session,
  cardId = "c03",
  participate = true,
  count = 3,
) {
  const settings = await json<GameSettings>(request, "/api/default-settings");
  for (const c of Object.values(settings.config)) c.count = 0;
  settings.config[cardId].count = count;
  return json<{ code: string }>(request, "/api/rooms", session.token, {
    name: "夜航主持",
    participate,
    settings,
    avatar: "c03",
  });
}
async function pageAs(
  browser: Browser,
  session: Session,
  code: string,
  viewport = { width: 390, height: 844 },
  pending = false,
) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    (value) => sessionStorage.setItem("snake-session", JSON.stringify(value)),
    { ...session, roomCode: code },
  );
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText(pending ? "等待现场批准" : "已同步", { exact: true })).toBeVisible();
  return { context, page };
}
async function socketAs(session: Session, code: string) {
  const consent = await fetch("http://127.0.0.1:5197/api/legal/accept", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({version:LEGAL_VERSION,adult:true,accepted:true}) });
  expect(consent.ok).toBeTruthy();
  const socket = io("http://127.0.0.1:5197", {
    extraHeaders: { Cookie: consent.headers.get("set-cookie")!.split(";")[0] },
    auth: { token: session.token },
    forceNew: true,
  });
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
    socket,
    get view() {
      if (!view) throw new Error("No room view");
      return view;
    },
    async action(type: string, data: Record<string, unknown> = {}) {
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
async function endRoom(client: Awaited<ReturnType<typeof socketAs>>) {
  if (client.view.state !== "ended") {
    if (client.view.controllerId !== client.view.ownerId)
      await client.action("reclaim");
    await client.action("end");
  }
  client.socket.disconnect();
}

test("真实移动端：审批、相对插入、加冕广播、持有牌、结束与再来一局", async ({
  browser,
  request,
}) => {
  const owner = await host(request);
  const { code } = await create(request, owner);
  const h = await pageAs(browser, owner, code, { width: 1365, height: 1000 });
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p = await playerContext.newPage();
  await p.goto(`/?room=${code}`);
  await p.getByLabel("你的昵称").fill("小雨");
  await p.getByRole("button", { name: "申请入场", exact: true }).click();
  await expect(p.getByText("等待现场批准", { exact: true })).toBeVisible();
  await expect(p.getByRole("button", { name: "开始这一局" })).toHaveCount(0);
  await h.page.getByRole("button", { name: "批准小雨", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "今夜，同桌入局。" }),
  ).toBeVisible();
  await h.page.getByRole("button", {name:"拖动头像安排座次"}).click();
  await h.page.getByRole("button", {name:/小雨.*待安排/}).click();
  await h.page.getByRole("button", {name:/将小雨放在夜航主持与夜航主持之间/}).click();
  await h.page.getByRole("dialog").getByRole("button", {name:"关闭",exact:true}).click();
  await expect(
    h.page.getByRole("button", { name: "开始这一局" }),
  ).toBeEnabled();
  await h.page.screenshot({
    path: "docs/visuals/qa-lobby-desktop.png",
    fullPage: true,
  });
  await p.screenshot({
    path: "docs/visuals/qa-lobby-mobile.png",
    fullPage: true,
  });
  await h.page.getByRole("button", { name: "开始这一局" }).click();
  await expect(
    h.page.getByRole("button", { name: "抽取你的牌", exact: true }).last(),
  ).toBeVisible();
  await h.page
    .getByRole("button", { name: "抽取你的牌", exact: true })
    .last()
    .click();
  await expect(
    p.locator(".event-overlay").getByRole("heading", { name: /已被加冕为王/ }),
  ).toBeVisible();
  await p.waitForTimeout(1300);
  await p.screenshot({
    path: "docs/visuals/qa-coronation-mobile.png",
    fullPage: false,
  });
  await h.page.waitForTimeout(3200);
  await expect(
    p.getByRole("button", { name: "抽取你的牌", exact: true }).last(),
  ).toBeEnabled();
  const drawBox = await p
    .getByRole("button", { name: "抽取你的牌", exact: true })
    .last()
    .boundingBox();
  const navBox = await p.locator(".room-bottom-nav").boundingBox();
  expect(
    drawBox && navBox && drawBox.y + drawBox.height <= navBox.y,
  ).toBeTruthy();
  await p.screenshot({
    path: "docs/visuals/qa-table-mobile.png",
    fullPage: false,
  });
  await p
    .getByRole("button", { name: "抽取你的牌", exact: true })
    .last()
    .click();
  await h.page.waitForTimeout(4500);
  await h.page
    .getByRole("button", { name: "抽取你的牌", exact: true })
    .last()
    .click();
  await h.page.waitForTimeout(4500);
  await expect(
    p.getByRole("heading", { name: "这一局，落幕。" }),
  ).toBeVisible();
  await expect(
    h.page.getByText("没有任何可抽牌", { exact: true }),
  ).toBeVisible();
  await h.page.getByRole("button", { name: "保留座次，再来一局" }).click();
  await expect(
    h.page.getByRole("button", { name: "开始这一局" }),
  ).toBeEnabled();
  const client = await socketAs(owner, code);
  await endRoom(client);
  await h.context.close();
  await playerContext.close();
});

test("多人权限：转交、备用接管、原主持收回、上传真实头像结束后 404", async ({
  browser,
  request,
}) => {
  const owner = await host(request);
  const { code } = await create(request, owner, "c02", false);
  const h = await socketAs(owner, code);
  const p1 = await json<Session>(request, "/api/join", undefined, {
    code,
    name: "阿川",
    avatar: "c07",
  });
  const p2 = await json<Session>(request, "/api/join", undefined, {
    code,
    name: "米粒",
    avatar: "c11",
  });
  await h.action("approve", { playerId: p1.actor.id });
  await h.action("approve", { playerId: p2.actor.id });
  const a = await socketAs(p1, code);
  const b = await socketAs(p2, code);
  await h.action("seat-insert", {
    afterId: h.view.seats[0].id,
    kind: "player",
    playerId: p1.actor.id,
  });
  await h.action("seat-insert", {
    afterId: h.view.seats[1].id,
    kind: "player",
    playerId: p2.actor.id,
  });
  await h.action("backup", { playerId: p2.actor.id });
  await h.action("start", { playerId: p1.actor.id });
  await h.action("transfer", { playerId: p1.actor.id });
  await expect.poll(() => a.view.controllerId).toBe(p1.actor.id);
  a.socket.disconnect();
  await expect.poll(() => b.view.state).toBe("paused");
  await expect.poll(() => b.view.controllerId).toBe(p2.actor.id);
  await h.action("reclaim");
  await expect.poll(() => h.view.controllerId).toBe(owner.actor.id);
  const upload = await request.post(`/api/rooms/${code}/avatar`, {
    headers: {
      Authorization: `Bearer ${p2.token}`,
      "X-Match-Id": h.view.matchId,
    },
    multipart: {
      avatar: {
        name: "avatar.png",
        mimeType: "image/png",
        buffer: readFileSync("public/art/cards/c03.png"),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const { avatar } = await upload.json();
  expect((await request.get(avatar)).ok()).toBeTruthy();
  const oldMatchId = h.view.matchId;
  await h.action("end");
  expect((await request.get(avatar)).status()).toBe(404);
  await h.action("again");
  const stale = await request.post(`/api/rooms/${code}/avatar`, {
    headers: { Authorization: `Bearer ${p2.token}`, "X-Match-Id": oldMatchId },
    multipart: {
      avatar: {
        name: "old.png",
        mimeType: "image/png",
        buffer: readFileSync("public/art/cards/c03.png"),
      },
    },
  });
  expect(stale.status()).toBe(400);
  expect((await stale.json()).error).toContain("牌局已变化");
  b.socket.disconnect();
  h.socket.disconnect();
});

test("三房每房 20 位真实 Socket 客户端，互不泄露牌局", async ({ request }) => {
  const all: Socket[] = [];
  const owners: Awaited<ReturnType<typeof socketAs>>[] = [];
  try {
    for (let r = 0; r < 3; r++) {
      const owner = await host(
        request,
        r === 0 ? "qa-host" : `qa-host-${r + 1}`,
      );
      const { code } = await create(request, owner, "c20");
      const h = await socketAs(owner, code);
      owners.push(h);
      all.push(h.socket);
      for (let i = 0; i < 19; i++) {
        const session = await json<Session>(request, "/api/join", undefined, {
          code,
          name: `第${r + 1}桌玩家${i + 1}`,
          avatar: "c03",
        });
        await h.action("approve", { playerId: session.actor.id });
        const client = await socketAs(session, code);
        all.push(client.socket);
        await h.action("seat-insert", {
          afterId: h.view.seats.at(-1)!.id,
          kind: "player",
          playerId: session.actor.id,
        });
        expect(client.view.code).toBe(code);
      }
      expect(
        h.view.players.filter((p) => p.approved && !p.removed),
      ).toHaveLength(20);
      await h.action("start");
      expect(h.view.turn?.playerId).toBe(h.view.hostPlayerId);
    }
  } finally {
    for (const h of owners) {
      try {
        await endRoom(h);
      } catch (e) {
        console.error("测试房间清理失败", e);
      }
    }
    for (const s of all) s.disconnect();
  }
});

test("全 32 张图鉴、动效预览、不同尺寸无横向溢出", async ({ browser }) => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 1000 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "加入牌局", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/visuals/qa-home-${viewport.width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "卡牌图鉴", exact:true }).first().click();
    await expect(page.locator(".catalog-card")).toHaveCount(32);
    for (const tile of await page.locator(".catalog-card").all()) {
      await tile.scrollIntoViewIfNeeded();
      await tile
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.decode());
    }
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [
              ...document.querySelectorAll<HTMLImageElement>(
                ".catalog-art img",
              ),
            ].filter((i) => i.complete && i.naturalWidth > 0).length,
        ),
      )
      .toBe(32);
    await page.screenshot({
      path: `docs/visuals/qa-catalog-${viewport.width}.png`,
      fullPage: true,
    });
    await page.locator(".catalog-card").nth(4).click();
    await page.getByRole("button", { name: "预览揭牌效果" }).click();
    await expect(page.getByText("动效预览 · 不计入牌局")).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("主持登录开局界面、邀请二维码与服务器多套模板", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "主持人开局", exact: true }).click();
  await page.getByLabel("登录名", { exact: true }).fill("qa-host");
  await page.getByLabel("密码", { exact: true }).fill("local-qa-password-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "开启今夜" })).toBeVisible();
  await page.getByLabel("今夜的主持昵称").fill("界面主持");
  await page.getByRole("button", { name: "仅控场" }).click();
  await page.getByRole("button", { name: "创建房间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今夜，同桌入局。" }),
  ).toBeVisible();
  const session = (await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("snake-session")!),
  )) as Session;
  ownersToClean.push(session);
  const code = session.roomCode!;
  await page.getByRole("button", { name: "邀请与二维码" }).click();
  await expect(
    page.getByRole("img", { name: "加入本房间的二维码" }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("img", { name: "加入本房间的二维码" })
      .getAttribute("src"),
  ).toMatch(/^data:image\/png/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "查看卡组配置" }).click();
  await page.getByRole("textbox", { name: "新模板名称" }).fill("轻松配置");
  await page.getByRole("button", { name: "保存为新模板" }).click();
  await expect(page.getByText("管理已保存模板（1）")).toBeVisible();
  await page.getByRole("textbox", { name: "新模板名称" }).fill("深夜配置");
  await page.getByRole("button", { name: "保存为新模板" }).click();
  await expect(page.getByText("管理已保存模板（2）")).toBeVisible();
  const saved = await json<unknown[]>(request, "/api/presets", session.token);
  expect(saved).toHaveLength(2);
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]) {
    await page.setViewportSize(viewport);
    const save=page.getByRole("button",{name:"保存为新模板",exact:true});
    const box=await save.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(64);
    expect(await page.locator(".template-save").evaluate(e=>e.scrollWidth<=e.clientWidth)).toBeTruthy();
    if(viewport.width===320) await page.screenshot({path:"docs/visuals/audit-template-save-320.png"});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({
    path: "docs/visuals/qa-host-settings-mobile.png",
    fullPage: false,
  });
  await context.close();
});

test("第二版：20人牌桌尺寸矩阵、弹窗居中、拖动与横屏", async ({browser,request}) => {
  test.setTimeout(90000);
  const owner=await host(request,"qa-host-3");
  const {code}=await create(request,owner,"c02",false,20);
  const h=await pageAs(browser,owner,code);
  const hostClient=await socketAs(owner,code);
  const clients: Awaited<ReturnType<typeof socketAs>>[]=[];
  let playerSession: Session | undefined;
  try {
    for(let i=0;i<20;i++) {
      const session=await json<Session>(request,"/api/join",undefined,{code,name:`玩家${i+1}`,avatar:"c03"});
      const c=await socketAs(session,code);clients.push(c);
      if(i===0) playerSession=session;
      await hostClient.action("approve",{playerId:session.actor.id});
    }
    await h.page.getByRole("button",{name:"拖动头像安排座次"}).click();
    const chip=h.page.getByRole("button",{name:"安排玩家1，待安排",exact:true});
    const start=await chip.boundingBox();expect(start).toBeTruthy();
    const touch=await h.context.newCDPSession(h.page);
    await touch.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:start!.x+20,y:start!.y+20,id:1}]});
    await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:start!.x+30,y:start!.y+30,id:1}]});
    const target=h.page.locator(".seat-drop-target").first();await target.scrollIntoViewIfNeeded();
    const dest=await target.boundingBox();expect(dest).toBeTruthy();
    await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:dest!.x+dest!.width/2,y:dest!.y+dest!.height/2,id:1}]});
    await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(h.page.getByRole("button",{name:"安排玩家1，已入座",exact:true})).toBeVisible();
    await h.page.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).click();
    for(const c of clients.slice(1)) await hostClient.action("seat-place",{playerId:c.view.selfPlayerId,afterId:hostClient.view.seats.at(-1)!.id,beforeId:hostClient.view.seats[0].id});
    await hostClient.action("draw-mode",{mode:"host"});
    await hostClient.action("start",{playerId:clients[0].view.selfPlayerId});
    const p=await pageAs(browser,playerSession!,code);
    try {
      for(const viewport of [{width:320,height:568},{width:360,height:740},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1280,height:590},{width:1440,height:900},{width:844,height:390},{width:667,height:375}]) {
        for(const page of [h.page,p.page]) {
          await page.setViewportSize(viewport);
          await expect(page.getByRole("button",{name:"桌图",exact:true})).toBeVisible();
          const geom=await page.evaluate(() => {
            const card=document.querySelector(".playing-card")!.getBoundingClientRect();
            const nav=document.querySelector(".room-bottom-nav")!.getBoundingClientRect();
            const quick=document.querySelector(".host-quick-actions")?.getBoundingClientRect();
            return {scroll:document.documentElement.scrollHeight, width:document.documentElement.scrollWidth, center:card.x+card.width/2, bottom:card.bottom, limit:quick?.top ?? nav.top};
          });
          expect(geom.width).toBeLessThanOrEqual(viewport.width);
          expect(geom.scroll).toBeLessThanOrEqual(viewport.height+1);
          if(viewport.height>500) expect(Math.abs(geom.center-viewport.width/2)).toBeLessThanOrEqual(4);
          expect(geom.bottom).toBeLessThanOrEqual(geom.limit+1);
          for(const label of ["桌图","本局剩余"]) {
            await page.getByRole("button",{name:label,exact:true}).click();
            await page.getByRole("dialog").evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
            if(label === "本局剩余") await expect(page.locator(".remaining-card")).toHaveCount(1);
            const box=await page.getByRole("dialog").boundingBox();expect(box).toBeTruthy();
            expect(Math.abs(box!.x+box!.width/2-viewport.width/2)).toBeLessThanOrEqual(2);
            expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
            await page.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).click();
          }
        }
        await h.page.screenshot({path:`docs/visuals/v2-host-${viewport.width}x${viewport.height}.png`});
      }
      await h.page.setViewportSize({width:390,height:844});
      await h.page.getByRole("button",{name:"抽取你的牌",exact:true}).click();
      await expect(p.page.locator(".playing-card-name")).toHaveText("敲 7");
      await h.page.getByRole("button",{name:"关闭本机动效",exact:true}).click();
      await hostClient.action("pause");
      await expect(p.page.getByRole("heading",{name:"牌局已暂停"})).toBeVisible();
      await p.page.getByRole("button",{name:"参与者",exact:true}).click();
      await expect(p.page.getByRole("heading",{name:"同桌玩家"})).toBeVisible();
      await p.page.getByRole("button",{name:"我的卡牌",exact:true}).click();
      await expect(p.page.getByRole("heading",{name:"我的持有牌"})).toBeVisible();
    } finally { await p.context.close(); }
  } finally {await endRoom(hostClient);for(const c of clients)c.socket.disconnect();await h.context.close();}
});

test("第二版：静默求助与备用隐私、首页两档吸附", async ({browser,request}) => {
  const owner=await host(request,"qa-host-3");const {code}=await create(request,owner,"c02");
  const hc=await socketAs(owner,code);
  const s=await json<Session>(request,"/api/join",undefined,{code,name:"求助玩家",avatar:"c07"});
  const b=await json<Session>(request,"/api/join",undefined,{code,name:"备用玩家",avatar:"c11"});
  const pc=await socketAs(s,code);const bc=await socketAs(b,code);
  await hc.action("approve",{playerId:s.actor.id});await hc.action("approve",{playerId:b.actor.id});await hc.action("backup",{playerId:b.actor.id});
  const p=await pageAs(browser,s,code);const h=await pageAs(browser,owner,code);const backup=await pageAs(browser,b,code);
  try {
    await p.page.getByRole("button",{name:"寻求帮助",exact:true}).click();
    await p.page.getByRole("button",{name:"受到骚扰",exact:true}).click();
    await p.page.getByLabel("补充原因（可选）").fill("只让主持看到的原因");
    await p.page.getByRole("button",{name:"静默发送",exact:true}).click();
    await expect(p.page.getByRole("heading",{name:"已静默通知主持人"})).toBeVisible();
    await expect(backup.page.getByText("有人需要帮助，请先告知原主持人。",{exact:true})).toBeVisible();
    expect(bc.view.helpRequests).toEqual([]);expect(pc.view.helpRequests).toEqual([]);
    expect(JSON.stringify(bc.view)).not.toContain("只让主持看到的原因");
    await h.page.getByRole("button",{name:"求助提醒",exact:true}).click();
    await expect(h.page.getByText("只让主持看到的原因",{exact:true})).toBeVisible();
    await h.page.getByRole("button",{name:"已联系，当面处理完成",exact:true}).click();
    await expect(backup.page.getByText("有人需要帮助，请先告知原主持人。",{exact:true})).toHaveCount(0);
    await p.page.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).click();
    await p.page.getByRole("button",{name:"参与者",exact:true}).click();
    await expect(p.page.getByRole("dialog",{name:"玩家管理"})).toBeVisible();
  } finally {await p.context.close();await h.context.close();await backup.context.close();await endRoom(hc);pc.socket.disconnect();bc.socket.disconnect();}
  const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});const home=await ctx.newPage();await home.goto("/");
  await expect(home.locator(".home-page")).toHaveCount(2);
  expect(await home.locator(".home-snap").evaluate(e=>getComputedStyle(e).scrollSnapType)).toBe("y mandatory");
  await home.getByRole("link",{name:"更多",exact:true}).click();
  await expect(home.getByRole("link",{name:"运营主体与联系",exact:true})).toBeInViewport();
  await expect(home.locator("body")).not.toContainText(OPERATOR);await expect(home.locator("body")).not.toContainText(CONTACT);
  await home.screenshot({path:"docs/visuals/v2-home-more-mobile.png"});await ctx.close();
});

test("参与者列表：移出按钮不挤压昵称，大厅和局内多尺寸保持横排", async ({browser,request}) => {
  const owner=await host(request,"qa-host-3");
  const {code}=await create(request,owner,"c02");
  const hc=await socketAs(owner,code);
  const clients: Awaited<ReturnType<typeof socketAs>>[]=[];
  const h=await pageAs(browser,owner,code);
  let player: Awaited<ReturnType<typeof pageAs>> | undefined;
  try {
    for(const name of ["亮","木马","kikikiki","这是用于检查参与者列表的二十四字超长中文昵称测试"]) {
      const session=await json<Session>(request,"/api/join",undefined,{code,name,avatar:"c03"});
      const client=await socketAs(session,code);clients.push(client);
      await hc.action("approve",{playerId:session.actor.id});
      await hc.action("seat-place",{playerId:session.actor.id,afterId:hc.view.seats.at(-1)!.id,beforeId:hc.view.seats[0].id});
      if(!player) player=await pageAs(browser,session,code);
    }
    const checkRows=async (page: Page, hasActions:boolean) => {
      await expect(page.locator(".player-management-row")).toHaveCount(5);
      const rows=await page.locator(".player-management-row").evaluateAll(elements=>elements.map(el=>{
        const row=el.getBoundingClientRect();
        const info=el.querySelector(".player-row > span:last-child")!.getBoundingClientRect();
        const name=el.querySelector("strong")!.getBoundingClientRect();
        const action=el.querySelector(".danger-button")?.getBoundingClientRect();
        return {height:row.height,infoWidth:info.width,nameHeight:name.height,actionWidth:action?.width,actionTop:action?.top,rowTop:row.top,actionRight:action?.right,rowRight:row.right};
      }));
      for(const row of rows) {
        expect(row.height).toBeLessThanOrEqual(88);
        expect(row.infoWidth).toBeGreaterThanOrEqual(70);
        expect(row.nameHeight).toBeLessThanOrEqual(32);
        if(row.actionWidth!==undefined) {
          expect(row.actionWidth).toBeLessThanOrEqual(80);
          expect(row.actionTop!-row.rowTop).toBeLessThanOrEqual(24);
          expect(row.actionRight).toBeLessThanOrEqual(row.rowRight+1);
        }
      }
      await expect(page.locator(".player-management-row .danger-button")).toHaveCount(hasActions ? 4 : 0);
      expect(await page.locator(".players-list").evaluate(e=>e.scrollWidth<=e.clientWidth)).toBeTruthy();
      if(await page.locator(".is-playing").count()) expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    };
    for(const width of [320,390,438,768]) {
      await h.page.setViewportSize({width,height:844});
      await h.page.getByRole("button",{name:"参与者",exact:true}).click();
      await checkRows(h.page,true);
      await h.page.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).click();
    }
    await hc.action("start");
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:438,height:957},{width:768,height:1024},{width:667,height:375}]) {
      for(const entry of [h,player!]) {
        await entry.page.setViewportSize(viewport);
        await entry.page.getByRole("button",{name:"参与者",exact:true}).click();
        await checkRows(entry.page,entry===h);
      }
    }
    await h.page.setViewportSize({width:438,height:957});
    await h.page.screenshot({path:"docs/visuals/qa-participants-host-438.png"});
    await player!.page.setViewportSize({width:390,height:844});
    await player!.page.screenshot({path:"docs/visuals/qa-participants-player-390.png"});
    await h.page.locator(".player-management-row").nth(1).getByRole("button",{name:"移出",exact:true}).click();
    await expect(h.page.getByRole("dialog",{name:"移出亮？"})).toBeVisible();
    await h.page.getByRole("button",{name:"取消",exact:true}).click();
    await h.page.locator(".player-row").nth(1).click();
    await expect(h.page.getByRole("dialog",{name:"亮",exact:true})).toBeVisible();
  } finally {await h.context.close();if(player)await player.context.close();await endRoom(hc);for(const c of clients)c.socket.disconnect();}
});

test("手机全面审查：公开页面、表单、图鉴及设置弹窗", async ({browser,request}) => {
  test.setTimeout(90000);
  const owner=await host(request);
  const issues:string[]=[];
  for(const viewport of mobileAuditSizes) {
    const context=await browser.newContext({viewport,reducedMotion:"reduce"});
    const page=await context.newPage();
    try {
      await page.goto("/");
      await auditMobileLayout(page,`${viewport.width}首页`,issues);
      await page.getByRole("button",{name:"声音与动效设置",exact:true}).click();
      await auditMobileLayout(page,`${viewport.width}偏好`,issues);await closeAuditDialog(page);
      await page.getByRole("button",{name:"卡牌图鉴",exact:true}).first().click();
      await expect(page.locator(".catalog-card")).toHaveCount(32);
      await auditMobileLayout(page,`${viewport.width}图鉴`,issues);
      for(const index of [6,8,9,16]) {
        await page.locator(".catalog-card").nth(index).click();
        await auditMobileLayout(page,`${viewport.width}图鉴详情${index}`,issues);await closeAuditDialog(page);
      }
      await page.getByRole("button",{name:"返回",exact:true}).click();
      await page.getByRole("button",{name:"加入牌局",exact:true}).click();
      await page.getByLabel("你的昵称").fill("W".repeat(24));
      await page.locator('input[type="file"]').setInputFiles({name:`${"W".repeat(120)}.webp`,mimeType:"image/webp",buffer:readFileSync("public/art/cards/c03.webp")});
      await auditMobileLayout(page,`${viewport.width}加入表单`,issues);
      await page.getByRole("button",{name:"返回",exact:true}).click();
      await page.getByRole("button",{name:"主持人开局",exact:true}).click();
      await auditMobileLayout(page,`${viewport.width}登录`,issues);
      await page.getByLabel("登录名").fill("qa-host");await page.getByLabel("密码").fill("local-qa-password-2026");
      await page.getByRole("button",{name:"登录",exact:true}).click();
      await expect(page.getByRole("heading",{name:"开启今夜"})).toBeVisible();
      await page.getByLabel("今夜的主持昵称").fill("W".repeat(24));
      await auditMobileLayout(page,`${viewport.width}开局表单`,issues);
      await page.locator(".settings-summary").click();
      for(const id of ["敲 7","国王牌","强制换座","逛三园","定时传花","PK"]) await page.getByRole("spinbutton",{name:`${id}张数`,exact:true}).fill("4");
      await page.getByLabel("配置名称",{exact:true}).fill("W".repeat(32));
      await auditMobileLayout(page,`${viewport.width}开局配置`,issues);
      if(viewport.width===320) await page.screenshot({path:"docs/visuals/audit-public-configuration-320.png"});
      await closeAuditDialog(page);
      await auditMobileLayout(page,`${viewport.width}长名称配置摘要`,issues);
    } finally {await context.close();}
  }
  expect(issues).toEqual([]);
});

test("手机全面审查：长昵称、模板、审批、座次、求助、记录及局内弹窗", async ({browser,request}) => {
  test.setTimeout(120000);
  const issues:string[]=[];
  const owner=await host(request,"qa-host-3");
  const settings=await json<GameSettings>(request,"/api/default-settings");
  for(const [id,c] of Object.entries(settings.config))c.count=id==="c03"?4:0;

  settings.name="W".repeat(32);
  settings.config.c03.count=3;
  const {code}=await json<{code:string}>(request,"/api/rooms",owner.token,{name:"W".repeat(24),participate:true,settings,avatar:"c03"});
  const hc=await socketAs(owner,code);
  await json(request,"/api/presets",owner.token,{name:"W".repeat(32),settings});
  const h=await pageAs(browser,owner,code);
  const s=await json<Session>(request,"/api/join",undefined,{code,name:"P".repeat(24),avatar:"c07"});
  const ps=await socketAs(s,code);
  const p=await pageAs(browser,s,code,undefined,true);
  const pending=await json<Session>(request,"/api/join",undefined,{code,name:"等".repeat(24),avatar:"c11"});
  h.page.setDefaultTimeout(10000);p.page.setDefaultTimeout(10000);
  try {
    for(const viewport of mobileAuditSizes) {
      await h.page.setViewportSize(viewport);await p.page.setViewportSize(viewport);
      await auditMobileLayout(p.page,`${viewport.width}等待审批`,issues);
      await auditMobileLayout(h.page,`${viewport.width}大厅`,issues);
      for(const panel of ["主持工具","邀请与二维码","声音与动效设置","拖动头像安排座次","查看卡组配置"]) {
        await h.page.getByRole("button",{name:panel,exact:true}).click();
        if(panel==="查看卡组配置") await h.page.locator(".template-manager summary").click();
        await auditMobileLayout(h.page,`${viewport.width}${panel}`,issues);
        if(panel==="查看卡组配置" && viewport.width===320) await h.page.screenshot({path:"docs/visuals/audit-room-templates-320.png"});
        await closeAuditDialog(h.page);
      }
      await h.page.locator(".table-seat").first().click();
      await auditMobileLayout(h.page,`${viewport.width}长昵称详情`,issues);await closeAuditDialog(h.page);
    }
    await hc.action("approve",{playerId:s.actor.id});
    for(const viewport of mobileAuditSizes) {
      await h.page.setViewportSize(viewport);
      await h.page.getByRole("button",{name:"拖动头像安排座次",exact:true}).click();
      await h.page.getByRole("button",{name:`安排${"P".repeat(24)}，待安排`,exact:true}).click();
      await auditMobileLayout(h.page,`${viewport.width}拖动安排提示`,issues);
      await h.page.getByRole("button",{name:"取消安排座次",exact:true}).click();
      await h.page.getByRole("dialog").getByRole("button",{name:"添加位置",exact:true}).click();
      await auditMobileLayout(h.page,`${viewport.width}插入玩家列表`,issues);
      await closeAuditDialog(h.page);await closeAuditDialog(h.page);
    }
    await hc.action("seat-place",{playerId:s.actor.id,afterId:hc.view.seats[0].id,beforeId:hc.view.seats[0].id});
    await hc.action("start");
    for(const viewport of mobileAuditSizes) {
      await h.page.setViewportSize(viewport);await p.page.setViewportSize(viewport);
      if(viewport.width===320) await p.page.screenshot({path:"docs/visuals/audit-player-table-320.png"});
      await p.page.getByRole("button",{name:"寻求帮助",exact:true}).click();
      await p.page.getByLabel("补充原因（可选）").fill("W".repeat(300));
      await auditMobileLayout(p.page,`${viewport.width}求助表单`,issues);await closeAuditDialog(p.page);
      for(const panel of ["桌图","本局剩余"]) {
        await p.page.getByRole("button",{name:panel,exact:true}).click();
        await auditMobileLayout(p.page,`${viewport.width}${panel}`,issues);await closeAuditDialog(p.page);
      }
      await h.page.getByRole("button",{name:"主持工具",exact:true}).click();
      await h.page.getByRole("button",{name:"卡组与模板",exact:true}).click();
      await auditMobileLayout(h.page,`${viewport.width}局内只读配置`,issues);await closeAuditDialog(h.page);
    }
    await ps.action("help",{category:"受到骚扰",reason:"W".repeat(300)});
    await h.page.setViewportSize({width:320,height:568});
    await auditMobileLayout(h.page,"320求助红点标题栏",issues);
    await h.page.getByRole("button",{name:"求助提醒",exact:true}).click();
    await auditMobileLayout(h.page,"320求助收件箱",issues);
    await closeAuditDialog(h.page);
    await hc.action("draw");
    await expect(h.page.locator(".event-overlay")).toBeVisible();
    await h.page.locator(".v3-effect__copy").evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
    for(const viewport of mobileAuditSizes) {
      await h.page.setViewportSize(viewport);await auditMobileLayout(h.page,`${viewport.width}长昵称加冕提示`,issues);
    }
    await expect.poll(()=>hc.view.turn?.playerId).toBe(s.actor.id);
    expect(hc.view.held).toHaveLength(1);
    for(const viewport of mobileAuditSizes) {
      await h.page.setViewportSize(viewport);
      await h.page.getByRole("button",{name:"我的卡牌",exact:true}).click();
      await auditMobileLayout(h.page,`${viewport.width}持有牌`,issues);
      await h.page.locator(".held-card").first().click();
      await auditMobileLayout(h.page,`${viewport.width}持有详情`,issues);await h.page.getByRole("button",{name:"收起详情",exact:true}).click();
      await h.page.getByRole("button",{name:"牌桌",exact:true}).click();
      await h.page.getByRole("button",{name:"主持工具",exact:true}).click();
      await h.page.getByRole("button",{name:"本局记录",exact:true}).click();
      await auditMobileLayout(h.page,`${viewport.width}长昵称记录`,issues);await closeAuditDialog(h.page);
    }
    await hc.action("end");
    for(const viewport of mobileAuditSizes){await h.page.setViewportSize(viewport);await auditMobileLayout(h.page,`${viewport.width}结束页`,issues);}
    expect(issues).toEqual([]);
  } finally {await h.context.close();await p.context.close();await endRoom(hc);ps.socket.disconnect();}
});

test("摄像头权限拒绝明确提示，不会伪造扫码结果", async ({ browser }) => {
  const issues:string[]=[];
  for(const viewport of mobileAuditSizes) {
  const context = await browser.newContext({
    viewport,
    permissions: [],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "加入牌局", exact: true }).click();
  await page.getByRole("button", { name: "打开摄像头扫码" }).click();
  await expect(
    page.getByRole("dialog", { name: "扫描房间二维码" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /摄像头启动失败|摄像头扫码需要/,
  );
  await expect(page.getByLabel("房间码", { exact: true })).toHaveValue("");
  await auditMobileLayout(page,`${viewport.width}扫码失败弹窗`,issues);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.getByLabel("房间码", { exact: true })).toBeVisible();
  await context.close();
  }
  expect(issues).toEqual([]);
});

test("结束页：主持与玩家均可返回首页，个人运营信息只在点击详情后显示",async({browser,request})=>{
 const game=await populated(request,"c02");const hostUI=await pageAs(browser,game.owner,game.code);const playerUI=await pageAs(browser,game.guests[0].session,game.code);
 try{
  await game.h.action("end");
  await expect(playerUI.page.getByRole("dialog")).toHaveCount(0);
  await expect(playerUI.page.getByRole("button", {name:"请我喝一杯",exact:true})).toHaveCount(0);
  for(const ui of [hostUI,playerUI]){
   await expect(ui.page.locator(".end-scene")).toBeVisible();await ui.page.locator(".end-scene").getByRole("button",{name:"返回首页",exact:true}).click();
   await expect(ui.page.getByRole("heading",{name:"今夜，谁先入局。",exact:true})).toBeVisible();await expect(ui.page.locator(".end-scene")).toHaveCount(0);await expect(ui.page).toHaveURL("http://127.0.0.1:5197/");
   await expect(ui.page.locator("body")).not.toContainText(OPERATOR);await expect(ui.page.locator("body")).not.toContainText(CONTACT);
   await ui.page.getByRole("link",{name:"更多",exact:true}).click();const next=ui.page.waitForEvent("popup");await ui.page.getByRole("link",{name:"运营主体与联系",exact:true}).click();const details=await next;
   await expect(details.locator("body")).toContainText(OPERATOR);await expect(details.locator("body")).toContainText(CONTACT);await details.close();
  }
 }finally{await hostUI.context.close();await playerUI.context.close();await game.close();}
});

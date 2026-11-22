import { test, expect } from "@playwright/test";
import { LEGAL_VERSION, CONTACT, OPERATOR } from "../../shared/legal";
test("首次确认：深链先拦截，主动勾选，同浏览器重访免弹，拒绝可读政策", async ({ page, request }) => {
  const denied = await request.post("/api/join", {data:{code:"123456",name:"无确认玩家",avatar:"avatar-1"}});
  expect(denied.status()).toBe(403);
  await page.goto("/?room=123456");
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await expect(page.getByRole("button",{name:"同意并进入",exact:true})).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(OPERATOR);await expect(page.locator("body")).not.toContainText(CONTACT);
  await page.getByRole("button",{name:"阅读隐私政策",exact:true}).click();await expect(dialog).toContainText("示例运营者（部署前替换）");await expect(dialog).toContainText("24小时");
  await expect(dialog).toContainText(CONTACT);
  await expect(dialog.getByRole("link",{name:CONTACT,exact:true})).toHaveAttribute("href",`mailto:${CONTACT}`);
  await page.getByRole("button",{name:"返回确认",exact:true}).click();
  await page.getByRole("button",{name:"不同意并退出",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText("您尚未同意",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"重新阅读与确认"}).click();
  await page.getByLabel("我已满十八周岁。",{exact:true}).check();await page.getByLabel("我已阅读并同意使用条款，已阅读并理解隐私政策。",{exact:true}).check();
  await page.getByRole("button",{name:"同意并进入",exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("房间码",{exact:true})).toHaveValue("123456");
  await page.reload();await expect(dialog).toHaveCount(0);await expect(page.getByLabel("房间码",{exact:true})).toHaveValue("123456");
  expect((await page.request.get("/api/legal/status")).ok()).toBeTruthy();
  expect((await page.request.get("/api/legal/status").then(r=>r.json())).accepted).toBe(true);
});
test("政策可公开直达，撤回记录后重新确认",async({page})=>{
 await page.goto("/legal/terms");await expect(page.getByRole("heading",{name:"使用条款",exact:true})).toBeVisible();
 await page.request.post("/api/legal/accept",{data:{version:LEGAL_VERSION,adult:true,accepted:true}});
 await page.getByRole("button",{name:"撤回确认并退出身份",exact:true}).click();await expect(page.getByRole("button",{name:"已撤回浏览器确认"})).toBeVisible();
 await page.goto("/");await expect(page.getByRole("dialog")).toBeVisible();
});
test("首次条款弹窗：320竖屏与基础横屏按钮可达，正文独立滚动",async({browser})=>{
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:844,height:390},{width:768,height:1024},{width:1280,height:590},{width:1440,height:900}]){
 const context=await browser.newContext({viewport});try{const page=await context.newPage();await page.goto("/");await expect(page.getByRole("dialog")).toBeVisible();
 const bounds=await page.getByRole("dialog").boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
 const button=await page.getByRole("button",{name:"同意并进入",exact:true}).boundingBox();expect(button!.y+button!.height).toBeLessThanOrEqual(viewport.height+1);
 await page.screenshot({path:`docs/visuals/legal-welcome-${viewport.width}x${viewport.height}.png`,animations:"disabled"});
 await page.getByRole("button",{name:"阅读隐私政策",exact:true}).click();expect(await page.locator(".flow-body").evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`docs/visuals/legal-consent-${viewport.width}x${viewport.height}.png`});
 }finally{await context.close();}}
});

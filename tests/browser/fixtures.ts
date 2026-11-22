import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { LEGAL_VERSION } from "../../shared/legal";
export async function acceptFor(request: APIRequestContext) {
  const r = await request.post("http://127.0.0.1:5197/api/legal/accept", { data: { version: LEGAL_VERSION, adult: true, accepted: true } });
  expect(r.ok()).toBeTruthy();
}
// 既有游戏验收先完成真实确认请求；条款本身的测试使用未经确认的新浏览器。
export const test = base.extend({
  browser: [async ({ browser }, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await original(options);
      await acceptFor(context.request);
      return context;
    };
    await use(browser);
    browser.newContext = original;
  }, { scope: "worker" }],
  request: async ({ request }, use) => { await acceptFor(request); await use(request); },
});
export { expect };
export type { APIRequestContext, Browser, Page } from "@playwright/test";

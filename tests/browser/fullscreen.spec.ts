import { test, expect } from "./fixtures";

test("全屏：原生进入/退出、浏览器退出事件同步、跨页面保持", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全屏显示", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("HTML");
  await expect(page.getByRole("button", { name: "退出全屏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBeTruthy();
  await page.getByRole("button", { name: "全屏显示", exact: true }).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("button", { name: "全屏显示", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "全屏显示", exact: true }).click();
  await page.getByRole("button", { name: "卡牌图鉴", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "退出全屏", exact: true })).toBeVisible();
  await page.locator(".catalog-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBeTruthy();
});

test("全屏：不支持和权限拒绝有可见提示，不伪造进入状态", async ({ browser }) => {
  for (const scenario of ["unsupported", "rejected"] as const) {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.addInitScript(kind => {
        if (kind === "unsupported") Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
        else Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
          configurable: true,
          value: () => Promise.reject(new DOMException("权限未允许", "NotAllowedError")),
        });
      }, scenario);
      await page.goto("/");
      await page.getByRole("button", { name: "全屏显示", exact: true }).click();
      const notice = page.getByRole("alert");
      await expect(notice).toContainText(scenario === "unsupported" ? "不支持网页全屏" : "无法切换全屏");
      const bounds = await notice.boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
      await expect(page.getByRole("button", { name: "全屏显示", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "全屏显示", exact: true })).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

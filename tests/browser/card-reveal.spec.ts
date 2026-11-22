import { test, expect } from "./fixtures";
import { CARDS, artUrl } from "../../shared/cards";

test("全部32张牌保留原卡面，无SVG场景，尊重减少动态设置", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "卡牌图鉴", exact: true }).first().click();
  for (const [index, card] of CARDS.entries()) {
    await page.locator(".catalog-card").nth(index).click();
    await page.getByRole("button", { name: "预览揭牌效果", exact: true }).click();
    const overlay = page.locator(".event-overlay");
    await expect(overlay).toBeVisible();
    const art = overlay.getByRole("img", { name: `${card.name}卡面`, exact: true });
    await expect(art).toHaveAttribute("src", artUrl(card.id));
    await art.evaluate((img: HTMLImageElement) => img.decode());
    await expect(overlay.locator(".v3-effect__scene, .fx-avatar-lips, .fx-name-lips, video")).toHaveCount(0);
    expect(await art.evaluate(img => getComputedStyle(img.parentElement!).animationName)).toBe("none");
    if (["c03", "c04", "c23"].includes(card.id)) {
      await page.screenshot({ path: `docs/visuals/card-reveal-${card.id}-390.png` });
    }
    await overlay.getByRole("button", { name: "关闭本机动效", exact: true }).click();
    await expect(overlay).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("首版国王光效恢复，其余31张主题光效有效，五刀依次出现", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "卡牌图鉴", exact: true }).first().click();
  for (const [index, card] of CARDS.entries()) {
    await page.locator(".catalog-card").nth(index).click();
    await page.getByRole("button", { name: "预览揭牌效果", exact: true }).click();
    const overlay = page.locator(".event-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".v3-effect__scene, foreignObject, svg path[d^='M131 265']")).toHaveCount(0);
    if (card.id === "c03") {
      await expect(overlay.locator(".event-rays > i")).toHaveCount(12);
      await expect(overlay.locator(".event-orbits > span")).toHaveCount(3);
      await expect(overlay.locator(".event-person .event-crown")).toBeVisible();
      expect(await overlay.locator(".event-rays").evaluate(e => getComputedStyle(e).animationName)).toBe("royal-rays");
      expect(await overlay.locator(".event-crown").evaluate(e => getComputedStyle(e).animationName)).toBe("crown-descend");
    } else {
      await expect(overlay.locator(".card-lights > i")).toHaveCount(5);
      const name = await overlay.locator(".card-lights > i").first().evaluate(e => getComputedStyle(e).animationName);
      expect(name).toMatch(/^light-/);
      expect(await overlay.locator(".card-lights > i").first().evaluate(e => e.getAnimations().length)).toBe(1);
    }
    // 使用浏览器实际动画对象采样，不依赖截图推断时序。
    if (card.id === "c04") {
      const result = await overlay.locator(".card-lights > i").evaluateAll(elements => {
        const animations = elements.map(e => e.getAnimations()[0]);
        const delays = animations.map(a => a.effect!.getTiming().delay!);
        const visible = delays.map(delay => {
          animations.forEach(a => { a.pause(); a.currentTime = delay + 110; });
          return elements.map((e, i) => Number(getComputedStyle(e).opacity) > .05 ? i : -1).filter(i => i !== -1);
        });
        return { delays, visible, durations: animations.map(a => a.effect!.getTiming().duration), angles: elements.map(e => getComputedStyle(e).getPropertyValue("--slash-angle").trim()) };
      });
      expect(result.delays.map(Math.round)).toEqual([150, 300, 450, 600, 750]);
      expect(result.visible).toEqual([[0], [1], [2], [3], [4]]);
      expect(result.durations).toEqual([220, 220, 220, 220, 220]);
      expect(result.angles).toEqual(["-55deg", "28deg", "-12deg", "62deg", "-35deg"]);
    }
    if (["c03", "c04", "c08", "c12", "c23", "c29", "c30"].includes(card.id)) {
      await overlay.evaluate((e, sample) => e.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = sample; }), card.id === "c03" ? 1800 : 700);
      await page.screenshot({ path: `docs/visuals/light-effects-${card.id}-390.png` });
    }
    if (card.id === "c03") {
      for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await overlay.locator(".event-copy").evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
        await page.screenshot({ path: `docs/visuals/light-effects-c03-${viewport.width}.png` });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await overlay.getByRole("button", { name: "关闭本机动效", exact: true }).click();
  }
  await context.close();
});

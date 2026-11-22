import { test, expect } from "./fixtures";
import { CARDS } from "../../shared/cards";

async function position(rail: import("@playwright/test").Locator) {
  return rail.evaluate(e => {
    const cards = Array.from(e.querySelectorAll<HTMLElement>(".hero-gallery-card"));
    const bounds = e.getBoundingClientRect();
    const distances = cards.map(card => { const r = card.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - bounds.left - bounds.width / 2); });
    const index = distances.indexOf(Math.min(...distances));
    return { index, id: cards[index].dataset.cardId, left: e.scrollLeft };
  });
}

test("首页随机全32张无缝同向循环，侧牌淡化且没有可见牌名", async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-08T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-08T10:00:01Z"));
  await page.goto("/");
  await page.clock.runFor(32);
  const rail = page.locator(".hero-card-rail");
  const main = rail.locator('.hero-gallery-card[data-copy="1"]');
  await expect(main).toHaveCount(32);
  await expect(rail.getByRole("button")).toHaveCount(32);
  const order = await main.evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.cardId));
  expect([...order].sort()).toEqual(CARDS.map(card => card.id).sort());
  expect(order).not.toEqual(CARDS.map(card => card.id));
  expect(await rail.innerText()).toBe("");
  expect((await position(rail)).id).toBe(order[0]);
  const opacities = await rail.locator('.hero-gallery-card').evaluateAll(cards => [31, 32, 33].map(i => Number(getComputedStyle(cards[i]).opacity)));
  expect(opacities[1]).toBeGreaterThan(.98);
  expect(opacities[0]).toBeLessThan(.35);
  expect(opacities[2]).toBeLessThan(.35);
  const seen = new Set([order[0]]);
  await page.clock.fastForward(2400);
  for (let step = 1; step <= 32; step++) {
    if (step === 32) {
      await rail.evaluate((e, id) => {
        const samples: number[] = [];
        (window as unknown as { loopSamples: number[] }).loopSamples = samples;
        const sample = () => {
          const center = e.getBoundingClientRect().left + e.clientWidth / 2;
          const offsets = Array.from(e.querySelectorAll<HTMLElement>(`[data-card-id="${id}"]`)).map(card => { const r = card.getBoundingClientRect(); return r.left + r.width / 2 - center; });
          samples.push(offsets.reduce((nearest, x) => Math.abs(x) < Math.abs(nearest) ? x : nearest));
          if (samples.length < 70) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, order[0]!);
    }
    await page.clock.runFor(1120);
    const current = await position(rail);
    expect(current.id).toBe(order[step % 32]);
    seen.add(current.id);
    const visible = rail.locator(".hero-gallery-card").nth(current.index);
    await expect(visible).toBeInViewport({ ratio: .9 });
    await visible.locator("img").evaluate((img: HTMLImageElement) => img.decode());
    if (step < 32) await page.clock.fastForward(1280);
  }
  expect(seen.size).toBe(32);
  const samples = await page.evaluate(() => (window as unknown as { loopSamples: number[] }).loopSamples);
  expect(samples.length).toBeGreaterThan(10);
  expect(samples[0]).toBeGreaterThan(100);
  expect(Math.abs(samples.at(-1)!)).toBeLessThan(2);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1);
    expect(samples[i - 1] - samples[i]).toBeLessThan(40);
  }
  expect((await position(rail)).index).toBe(32);
  await rail.dispatchEvent("pointerdown");
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(async () => (await position(rail)).id, { message: `${viewport.width}尺寸保持当前卡面`, timeout: 2000 }).toBe(order[0]);
    await page.screenshot({ path: `docs/visuals/seamless-home-${viewport.width}.png` });
  }
  await main.first().click();
  await expect(page.locator(".catalog-card")).toHaveCount(32);
  await context.close();
});

test("首页切换柔和加减速，可立即暂停及手动接管", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-08T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-08T10:00:01Z"));
  await page.goto("/");
  await page.clock.runFor(32);
  const rail = page.locator(".hero-card-rail");
  const start = (await position(rail)).left;
  const step = await rail.evaluate(e => { const cards = e.querySelectorAll<HTMLElement>(".hero-gallery-card"); return cards[1].offsetLeft - cards[0].offsetLeft; });
  await page.clock.fastForward(2400);
  await page.clock.runFor(275);
  const quarter = ((await position(rail)).left - start) / step;
  await page.clock.runFor(550);
  const threeQuarters = ((await position(rail)).left - start) / step;
  expect(quarter).toBeGreaterThan(.03);
  expect(quarter).toBeLessThan(.18);
  expect(threeQuarters).toBeGreaterThan(.82);
  expect(threeQuarters).toBeLessThan(.98);
  await rail.dispatchEvent("pointerdown");
  const interrupted = (await position(rail)).left;
  await page.clock.runFor(6000);
  expect((await position(rail)).left).toBe(interrupted);
  await rail.dispatchEvent("pointerup");
  await page.clock.runFor(6000);
  expect((await position(rail)).left).toBeGreaterThan(interrupted);
  await expect(page.getByRole("button", { name: /暂停轮播|继续轮播/ })).toHaveCount(0);
  await context.close();
});

test("减少动态模式使用单组32张手动浏览，不自动横滑", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-08T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-08T10:00:01Z"));
  await page.goto("/");
  const rail = page.locator(".hero-card-rail");
  await expect(rail.locator(".hero-gallery-card")).toHaveCount(32);
  const before = (await position(rail)).left;
  await page.clock.fastForward(10000);
  expect((await position(rail)).left).toBe(before);
  await expect(page.getByRole("button", { name: "暂停轮播", exact: true })).toHaveCount(0);
  await rail.locator(".hero-gallery-card").last().scrollIntoViewIfNeeded();
  await expect(rail.locator(".hero-gallery-card").last()).toBeInViewport();
  await context.close();
});

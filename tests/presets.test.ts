import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createRoom, defaultSettings, validateSettings } from "../server/engine.js";
import { PRESET_PACKS, installPresetPacks } from "../server/preset-packs.js";

test("7套配牌总数准确、机制未定牌均为0且互不影响默认配置", () => {
  const before = defaultSettings();
  assert.deepEqual(PRESET_PACKS.map(pack => Object.values(pack.settings.config).reduce((sum, card) => sum + card.count, 0)), [16, 24, 24, 32, 36, 48, 60]);
  assert.equal(new Set(PRESET_PACKS.map(pack => pack.name)).size, 7);
  for (const pack of PRESET_PACKS) {
    assert.deepEqual(validateSettings(pack.settings), pack.settings);
    assert.equal(pack.settings.config.c06.count, 0);
    assert.equal(pack.settings.config.c11.count, 0);
  }
  assert.equal(Object.values(PRESET_PACKS[6].settings.config).filter(c => c.count === 2).length, 30);
  assert.deepEqual(defaultSettings(), before);
});

test("持久化安装预设可重复执行，保留自定义模板、房间与账号", () => {
  const dir = mkdtempSync(join(tmpdir(), "snake-preset-"));
  const store = new Store(dir);
  try {
    const id = store.createHost("preset-host", "preset-host-password");
    const other = store.createHost("preset-host-two", "preset-host-password");
    const custom = store.savePreset(id, "自己的配牌", defaultSettings());
    const room = createRoom({ id, kind: "host" }, "测试主持", "676767", true, defaultSettings());
    store.saveRoom(room);
    const roomBefore = store.db.prepare("SELECT payload FROM rooms").get();
    const savedBefore = store.presets(id).find(p => p.id === custom);
    const first = installPresetPacks(store);
    assert.equal(first.inserted, 14);
    assert.equal(store.presets(id).length, 8);
    assert.equal(store.presets(other).length, 7);
    assert.deepEqual(store.presets(id).find(p => p.id === custom), savedBefore);
    assert.deepEqual(store.db.prepare("SELECT payload FROM rooms").get(), roomBefore);
    const again = installPresetPacks(store);
    assert.equal(again.inserted, 0);
    assert.equal(again.existing, 14);
    assert.equal(store.login("preset-host", "preset-host-password").id, id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("同名不同配置触发全组回滚，不覆盖用户模板或留下部分预设", () => {
  const dir = mkdtempSync(join(tmpdir(), "snake-preset-conflict-"));
  const store = new Store(dir);
  try {
    const first = store.createHost("first-preset-host", "preset-host-password");
    const second = store.createHost("second-preset-host", "preset-host-password");
    const settings = structuredClone(PRESET_PACKS[0].settings);
    settings.config.c02.count++;
    const id = store.savePreset(second, PRESET_PACKS[0].name, settings);
    const before = store.presets(second);
    assert.throws(() => installPresetPacks(store), /同名模板.*未覆盖/);
    assert.equal(store.presets(first).length, 0);
    assert.deepEqual(store.presets(second), before);
    assert.equal(store.presets(second)[0].id, id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("安装不突破每主持30套上限", () => {
  const dir = mkdtempSync(join(tmpdir(), "snake-preset-limit-"));
  const store = new Store(dir);
  try {
    const id = store.createHost("limit-preset-host", "preset-host-password");
    for (let i = 0; i < 24; i++) store.savePreset(id, `自定义${i}`, defaultSettings());
    assert.throws(() => installPresetPacks(store), /30套模板上限/);
    assert.equal(store.presets(id).length, 24);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

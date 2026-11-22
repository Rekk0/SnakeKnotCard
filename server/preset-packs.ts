import { isDeepStrictEqual } from "node:util";
import { defaultSettings, validateSettings, requireThat } from "./engine.js";
import { CARDS } from "../shared/cards.js";
import type { GameSettings } from "../shared/types.js";
import type { Store } from "./store.js";

interface PresetPack {
  name: string;
  description: string;
  settings: GameSettings;
}

function pack(name: string, description: string, counts: Record<string, number>): PresetPack {
  const settings = defaultSettings();
  for (const config of Object.values(settings.config)) config.count = 0;
  for (const [id, count] of Object.entries(counts)) {
    requireThat(Object.hasOwn(settings.config, id), `预设含未知卡牌：${id}`);
    settings.config[id].count = count;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  settings.name = `${name} · ${total}张`;
  return { name: settings.name, description, settings: validateSettings(settings) };
}

export const PRESET_PACKS: PresetPack[] = [
  pack("快局试玩", "4–6人，较少抽牌，尝试现场任务和几种软件交互。", {
    c02: 3, c20: 3, c22: 2, c03: 1, c05: 1, c04: 1,
    c21: 1, c32: 1, c09: 1, c29: 1, c10: 1,
  }),
  pack("新客热场", "4–8人，以报数、接词、PK等现场流程热场。", {
    c02: 5, c20: 5, c22: 4, c29: 3, c31: 3, c03: 2, c09: 2,
  }),
  pack("线上互动", "4–8人，侧重过5关、传花、天菜和桌图操作。", {
    c04: 4, c21: 4, c32: 4, c05: 3, c12: 2,
    c03: 2, c10: 2, c30: 1, c20: 2,
  }),
  pack("身份交锋", "6–10人，侧重身份替换、多人连结和持续权限。", {
    c03: 3, c08: 3, c12: 4, c13: 2, c14: 2, c15: 2,
    c28: 2, c30: 2, c10: 3, c02: 3, c20: 3, c05: 3,
  }),
  pack("熟人互动", "6–10人，告白、拍卖与现场动作较多，适合熟悉规则的一桌。", {
    c01: 2, c07: 2, c16: 2, c17: 2, c18: 2, c19: 2,
    c23: 2, c24: 2, c25: 2, c26: 2, c27: 2,
    c08: 2, c13: 1, c14: 1, c15: 2, c05: 2, c03: 2, c22: 2, c29: 2,
  }),
  pack("大桌轮转", "10–20人，以全场参与的现场任务为主，配少量软件互动。", {
    c02: 8, c20: 8, c22: 6, c31: 4, c29: 4,
    c03: 4, c05: 4, c09: 4, c21: 3, c32: 3,
  }),
  pack("全牌体验", "6–12人，30种已定牌各2张，体验完整卡组。", Object.fromEntries(
    CARDS.filter(card => card.ready).map(card => [card.id, 2]),
  )),
];

/** 安装到每个预设主持账号。已有同名自定义模板绝不覆盖；全组事务提交。 */
export function installPresetPacks(store: Store) {
  const owners = store.db.prepare("SELECT id FROM hosts ORDER BY login").all() as { id: string }[];
  requireThat(owners.length > 0, "没有预设主持账号，请先配置主持账号");
  let inserted = 0;
  let existing = 0;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const owner of owners) {
      const saved = store.presets(owner.id);
      const additions: PresetPack[] = [];
      for (const preset of PRESET_PACKS) {
        const matches = saved.filter(item => item.name === preset.name);
        requireThat(matches.length <= 1, `有多个同名模板“${preset.name}”，请先整理；未覆盖`);
        if (matches.length) {
          requireThat(isDeepStrictEqual(matches[0].settings, preset.settings), `同名模板“${preset.name}”已有不同内容，请先重命名；未覆盖`);
          existing++;
        } else additions.push(preset);
      }
      requireThat(saved.length + additions.length <= 30, "加入预设后超过每个主持30套模板上限；未覆盖，请先整理现有模板");
      for (const preset of additions) {
        store.savePreset(owner.id, preset.name, preset.settings);
        inserted++;
      }
    }
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
  return { hosts: owners.length, inserted, existing, packs: PRESET_PACKS.map(item => item.name) };
}

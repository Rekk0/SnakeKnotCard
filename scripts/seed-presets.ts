import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.js";
import { requireThat } from "../server/engine.js";
import { installPresetPacks } from "../server/preset-packs.js";

const specifiedDir = process.env.DATA_DIR;
requireThat(typeof specifiedDir === "string" && specifiedDir.trim().length > 0, "请明确设置DATA_DIR，预设工具不会自行选择或创建数据库");
const dir = resolve(specifiedDir);
const path = resolve(dir, "snakeknot.sqlite");
requireThat(existsSync(path), "目标数据库不存在，请先配置主持账号");
const check = new DatabaseSync(path, { readOnly: true });
try {
  const rows = check.prepare("SELECT payload FROM rooms").all() as { payload: string }[];
  requireThat(rows.every(row => JSON.parse(row.payload).schemaVersion === 3), "目标含旧版房间，请先显式升级；预设工具不负责迁移房间");
} finally {
  check.close();
}
const store = new Store(dir);
try {
  console.log(JSON.stringify(installPresetPacks(store), null, 2));
} finally {
  store.close();
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
const dir = mkdtempSync(join(tmpdir(), "snake-prod-"));
const store = new Store(dir);
store.createHost("production-smoke", "production-smoke-password");
store.close();
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: "5199", DATA_DIR: dir },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (c) => (output += String(c)));
child.stderr.on("data", (c) => (output += String(c)));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const r = await fetch("http://127.0.0.1:5199/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch (e) {
      if (i === 99) throw e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "生产服务未启动");
  const html = await fetch("http://127.0.0.1:5199/").then((r) => r.text());
  assert.match(html, /蛇结/);
  assert.match(html, /assets\/index/);
  for (const path of [
    "/art/brand/logo.webp",
    "/art/brand/card-back.webp",
    "/art/cards/c32.webp",
  ]) {
    const response = await fetch("http://127.0.0.1:5199" + path);
    assert.ok(response.ok, `${path}不存在`);
    assert.match(response.headers.get("content-type")!, /image\/webp/);
  }
  const consent = await fetch("http://127.0.0.1:5199/api/legal/accept", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:"example-2026-11-23.1",adult:true,accepted:true})});
  assert.ok(consent.ok);
  const login = await fetch("http://127.0.0.1:5199/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: consent.headers.get("set-cookie")!.split(";")[0] },
    body: JSON.stringify({
      login: "production-smoke",
      password: "production-smoke-password",
    }),
  });
  assert.ok(login.ok, "生产模式登录失败");
  console.log("生产模式验证通过：静态构建、真实品牌与卡面、API 登录。");
} finally {
  if (child.exitCode === null)
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  rmSync(dir, { recursive: true });
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrateSettings } from "../server/migration.js";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../server/store.js";
import { createRoom, defaultSettings } from "../server/engine.js";

test("主持创建工具遵守DATA_DIR且不输出密码", () => {
  const dir = mkdtempSync(join(tmpdir(), "snake-host-script-"));
  try {
    const dataDir = join(dir, "target");
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/create-host.ts")], {
      cwd: dir,
      env: { ...process.env, DATA_DIR: dataDir, HOST_LOGIN: "script-host", HOST_PASSWORD: "script-test-password" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("script-test-password"), false);
    const store = new Store(dataDir);
    try { assert.equal(store.login("script-host", "script-test-password").kind, "host"); }
    finally { store.close(); }
    assert.deepEqual(readdirSync(dir), ["target"]);
  } finally { rmSync(dir, { recursive: true }); }
});
test("SQLite 保存真实牌局、多个配置模板，令牌哈希可恢复和撤销", () => {
  const dir = mkdtempSync(join(tmpdir(), "snake-store-"));
  let store = new Store(dir);
  try {
    const ownerId = store.createHost("test-host", "a-test-password-123");
    assert.throws(() => store.login("test-host", "wrong"), /不正确/);
    const actor = store.login("test-host", "a-test-password-123");
    const session = store.session(actor);
    assert.deepEqual(store.authenticate(session.token), actor);
    const raw = store.db.prepare("SELECT hash FROM sessions").get() as {
      hash: string;
    };
    assert.notEqual(raw.hash, session.token);
    const room = createRoom(actor, "主持", "654321", true, defaultSettings());
    store.saveRoom(room);
    store.savePreset(ownerId, "轻松局", defaultSettings());
    store.savePreset(ownerId, "第二组", { ...defaultSettings(), direction: -1 });
    store.close();
    store = new Store(dir);
    assert.equal(store.rooms()[0].id, room.id);
    assert.equal(store.presets(ownerId).length, 2);
    assert.deepEqual(store.authenticate(session.token), actor);
    store.revokePlayer(actor.id);
    assert.throws(() => store.authenticate(session.token), /身份已过期/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("旧大厅与有限模板显式升级，张数和主持账号保持", () => {
  const dir=mkdtempSync(join(tmpdir(),"snake-migrate-"));
  let store=new Store(dir);
  try {
    const id=store.createHost("old-host","old-host-password");
    const room=createRoom({id,kind:"host"},"旧主持","123123",true,defaultSettings());
    const old=JSON.parse(JSON.stringify(room));
    old.schemaVersion=2;delete old.pendingDrawMode;delete old.helpRequests;
    old.settings.maxDraws=50;
    old.settings.config=Object.fromEntries(Object.entries(room.settings.config).map(([id,c])=>[id,{enabled:c.count>0,mode:"finite",count:c.count===0?1:c.count,weight:1}]));
    store.db.prepare("INSERT INTO rooms VALUES(?,?,?,?)").run(room.code,id,room.state,JSON.stringify(old));
    store.db.prepare("INSERT INTO presets VALUES(?,?,?,?,?)").run("old-preset",id,"旧模板",JSON.stringify(old.settings),Date.now());
    store.close();store=new Store(dir);
    const migrated=store.rooms()[0];
    assert.equal(migrated.schemaVersion,3);assert.equal(migrated.settings.drawMode,"player");
    assert.equal(migrated.turn,null);assert.deepEqual(migrated.settings.config,room.settings.config);
    assert.deepEqual(migrated.helpRequests,[]);assert.equal(store.presets(id)[0].settings.drawMode,"player");
    assert.equal(store.login("old-host","old-host-password").id,id);
    const backup=JSON.parse(readFileSync(join(dir,readdirSync(dir).find(f=>f.startsWith("migration-v3-"))!),"utf8"));
    assert.equal(JSON.parse(backup.rooms[0].payload).schemaVersion,2);
    assert.equal(JSON.parse(backup.presets[0].settings).maxDraws,50);
    store.close();store=new Store(dir);assert.equal(store.rooms()[0].turn,null);
    // 用实际备份恢复被迁移的原字段，再证明重新迁移可重试、账号仍可登录。
    store.db.exec("BEGIN IMMEDIATE");
    for(const row of backup.rooms)store.db.prepare("UPDATE rooms SET payload=? WHERE code=?").run(row.payload,row.code);
    for(const row of backup.presets)store.db.prepare("UPDATE presets SET settings=? WHERE id=?").run(row.settings,row.id);
    store.db.exec("COMMIT");
    assert.equal((store.db.prepare("SELECT payload FROM rooms WHERE code=?").get(room.code) as {payload:string}).payload,backup.rooms[0].payload);
    assert.equal((store.db.prepare("SELECT settings FROM presets WHERE id=?").get("old-preset") as {settings:string}).settings,backup.presets[0].settings);
    assert.equal(store.login("old-host","old-host-password").id,id);
    store.close();store=new Store(dir);
    assert.equal(store.rooms()[0].schemaVersion,3);
    assert.deepEqual(store.rooms()[0].settings.config,room.settings.config);
  } finally {store.close();rmSync(dir,{recursive:true});}
});

test("旧活跃局阻止迁移，所有原记录保持且没有部分升级",()=>{
 const dir=mkdtempSync(join(tmpdir(),"snake-block-migrate-"));let store=new Store(dir);
 try{
  const owner=store.createHost("blocked-host","migration-password");
  const room=createRoom({id:owner,kind:"host"},"迁移主持","919191",true,defaultSettings());
  const original={...room,schemaVersion:2,state:"paused"};const payload=JSON.stringify(original);
  store.db.prepare("INSERT INTO rooms VALUES(?,?,?,?)").run(room.code,owner,"paused",payload);store.close();
  assert.throws(()=>new Store(dir),/旧版活跃局/);
  const db=new DatabaseSync(join(dir,"snakeknot.sqlite"));
  try{assert.equal((db.prepare("SELECT payload FROM rooms").get() as {payload:string}).payload,payload);assert.equal((db.prepare("SELECT COUNT(*) AS n FROM hosts").get() as {n:number}).n,1);}finally{db.close();}
  assert.equal(readdirSync(dir).some(f=>f.startsWith("migration-v3-")),false);
 }finally{rmSync(dir,{recursive:true});}
});

test("旧概率模板明确拒绝，不猜实体张数；有限模板保留原数字并去掉旧权重",()=>{
 const base=defaultSettings();
 const config=Object.fromEntries(Object.entries(base.config).map(([id,c])=>[id,{enabled:c.count>0,mode:"finite",weight:90,count:c.count===0?1:c.count}]));
 const old={...base,maxDraws:50,config};
 assert.deepEqual(migrateSettings(old).config,base.config);
 config.c02.mode="probability";
 assert.throws(()=>migrateSettings(old),/不从权重猜牌数/);
 config.c02.mode="finite";config.c02.count=NaN;
 assert.throws(()=>migrateSettings(old),/张数无效/);
});

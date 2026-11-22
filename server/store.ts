import { migrateSettings } from "./migration.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { requireThat, textInput } from "./engine.js";
import type {
  Actor,
  Room,
  GameSettings,
  StoredPreset,
} from "../shared/types.js";

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class Store {
  db: DatabaseSync;
  dir: string;
  constructor(dir = resolve("data")) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(resolve(dir, "snakeknot.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS hosts(id TEXT PRIMARY KEY,login TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,owner_id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_room ON rooms(owner_id) WHERE state!='ended';
      CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,settings TEXT NOT NULL,updated INTEGER NOT NULL);
    `);
    this.migrateV3();
  }
  private migrateV3() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rooms=this.db.prepare("SELECT code,payload FROM rooms").all() as {code:string;payload:string}[];
      const presets=this.db.prepare("SELECT id,settings FROM presets").all() as {id:string;settings:string}[];
      const changes:{kind:"room"|"preset";id:string;value:string}[]=[];
      for(const row of rooms){
        const room=JSON.parse(row.payload);
        if(room.schemaVersion===3)continue;
        requireThat(room.schemaVersion===2||room.schemaVersion===undefined,"房间快照版本不受支持");
        requireThat(room.state!=="running"&&room.state!=="paused",`房间${row.code}仍是旧版活跃局，请先在旧版结束；迁移未修改数据`);
        room.settings=migrateSettings(room.settings);
        room.schemaVersion=3;room.persistedAt=Date.now();room.links=[];room.nicknames={};room.cardUses=[];room.alertCooldowns={};room.alertEvent=null;
        if(room.pendingDrawMode===undefined)room.pendingDrawMode=null;
        if(room.helpRequests===undefined)room.helpRequests=[];
        changes.push({kind:"room",id:row.code,value:JSON.stringify(room)});
      }
      for(const row of presets){
        const settings=JSON.parse(row.settings);
        if(!Object.hasOwn(settings,"maxDraws")&&Object.values(settings.config as Record<string,object>).every(c=>Object.keys(c).length===1&&"count" in c)&&settings.drawMode!==undefined)continue;
        changes.push({kind:"preset",id:row.id,value:JSON.stringify(migrateSettings(settings))});
      }
      if(changes.length){
        // 备份迁移涉及的原始记录；账号与会话表不会被迁移修改。
        const backup=resolve(this.dir,`migration-v3-${Date.now()}.json`);
        writeFileSync(backup,JSON.stringify({rooms,presets}),{mode:0o600,flag:"wx"});
        for(const change of changes){
          if(change.kind==="room")this.db.prepare("UPDATE rooms SET payload=? WHERE code=?").run(change.value,change.id);
          else this.db.prepare("UPDATE presets SET settings=? WHERE id=?").run(change.value,change.id);
        }
        console.info(`已显式迁移${changes.length}项至实体牌池；旧权重与独立抽数上限已移除，原始记录备份：${backup}`);
      }
      this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");this.db.close();throw error;}
  }
  createHost(login: string, password: string) {
    const name = textInput(login, "登录名", 40);
    requireThat(
      password.length >= 10 && password.length <= 200,
      "密码需为 10–200 个字符",
    );
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO hosts VALUES(?,?,?)")
      .run(id, name, passwordHash(password));
    return id;
  }
  bootstrapDevelopment() {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM hosts").get() as {
      n: number;
    };
    if (count.n > 0) return;
    requireThat(
      process.env.NODE_ENV !== "production",
      "尚未配置主持账号，请先运行 npm run host:create",
    );
    const password = randomBytes(12).toString("base64url");
    this.createHost("snakeknot", password);
    writeFileSync(
      resolve(this.dir, "local-host.txt"),
      `仅本地开发账号\n登录名：snakeknot\n密码：${password}\n\n请勿提交此文件；部署前创建自己的主持账号。\n`,
      { mode: 0o600 },
    );
    console.info(
      "已创建本地主持账号，凭据保存在 data/local-host.txt（不会提交到 Git）",
    );
  }
  login(login: unknown, password: unknown): Actor {
    const name = textInput(login, "登录名", 40);
    requireThat(
      typeof password === "string" && password.length <= 200,
      "密码无效",
    );
    const row = this.db
      .prepare("SELECT * FROM hosts WHERE login=?")
      .get(name) as { id: string; password: string } | undefined;
    requireThat(
      row && verifyPassword(password, row.password),
      "登录名或密码不正确",
    );
    return { id: row.id, kind: "host" };
  }
  session(actor: Actor) {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(
        tokenHash(token),
        JSON.stringify(actor),
        Date.now() + 24 * 60 * 60 * 1000,
      );
    return { token, actor, roomCode: actor.roomCode };
  }
  authenticate(token: unknown): Actor {
    requireThat(
      typeof token === "string" && token.length <= 100,
      "请先登录或加入房间",
    );
    const row = this.db
      .prepare("SELECT actor,expires FROM sessions WHERE hash=?")
      .get(tokenHash(token)) as { actor: string; expires: number } | undefined;
    requireThat(
      row && row.expires > Date.now(),
      "身份已过期，请重新登录或申请入场",
    );
    return JSON.parse(row.actor);
  }
  revokePlayer(id: string) {
    const rows = this.db.prepare("SELECT hash,actor FROM sessions").all() as {
      hash: string;
      actor: string;
    }[];
    for (const row of rows)
      if ((JSON.parse(row.actor) as Actor).id === id)
        this.db.prepare("DELETE FROM sessions WHERE hash=?").run(row.hash);
  }
  saveRoom(room: Room) {
    room.persistedAt=Date.now();
    this.db
      .prepare(
        "INSERT INTO rooms VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET owner_id=excluded.owner_id,state=excluded.state,payload=excluded.payload",
      )
      .run(room.code, room.ownerId, room.state, JSON.stringify(room));
  }
  rooms(): Room[] {
    return (
      this.db.prepare("SELECT payload FROM rooms").all() as {
        payload: string;
      }[]
    ).map((r) => JSON.parse(r.payload));
  }
  removeRoom(code: string) {
    this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  }
  presets(owner: string): StoredPreset[] {
    return (
      this.db
        .prepare("SELECT * FROM presets WHERE owner_id=? ORDER BY updated DESC")
        .all(owner) as {
        id: string;
        name: string;
        settings: string;
        updated: number;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      settings: JSON.parse(r.settings),
      updatedAt: r.updated,
    }));
  }
  savePreset(owner: string, name: string, settings: GameSettings, id?: string) {
    const key = id === undefined ? randomUUID() : id;
    if (id !== undefined)
      requireThat(
        this.presets(owner).some((p) => p.id === id),
        "配置模板不存在",
      );
    this.db
      .prepare(
        "INSERT INTO presets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,settings=excluded.settings,updated=excluded.updated",
      )
      .run(
        key,
        owner,
        textInput(name, "模板名称", 32),
        JSON.stringify(settings),
        Date.now(),
      );
    return key;
  }
  deletePreset(owner: string, id: string) {
    const result = this.db
      .prepare("DELETE FROM presets WHERE id=? AND owner_id=?")
      .run(id, owner);
    requireThat(Number(result.changes) === 1, "模板不存在");
  }
  close() {
    this.db.close();
  }
}

import type { DatabaseSync } from "node:sqlite";
export const INACTIVE_LIMIT = 24 * 60 * 60 * 1000;
export class RoomActivity {
  constructor(readonly db: DatabaseSync) { db.exec("CREATE TABLE IF NOT EXISTS room_activity(id TEXT PRIMARY KEY,last_action INTEGER NOT NULL)"); }
  seed(id: string, persistedAt: number) {
    if (!Number.isFinite(persistedAt)) throw new Error("房间缺少有效持久化时间，不能初始化清理期限");
    this.db.prepare("INSERT OR IGNORE INTO room_activity VALUES(?,?)").run(id, persistedAt);
  }
  touch(id: string, now = Date.now()) { this.db.prepare("INSERT INTO room_activity VALUES(?,?) ON CONFLICT(id) DO UPDATE SET last_action=excluded.last_action").run(id, now); }
  expired(id: string, now: number) {
    const row = this.db.prepare("SELECT last_action FROM room_activity WHERE id=?").get(id);
    if (!row) throw new Error("缺少房间操作时间记录");
    return now - Number(row.last_action) >= INACTIVE_LIMIT;
  }
  remove(id: string) { this.db.prepare("DELETE FROM room_activity WHERE id=?").run(id); }
}

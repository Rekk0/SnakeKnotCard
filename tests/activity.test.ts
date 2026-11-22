import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LegalConsent } from "../server/legal.js";
import { RoomActivity, INACTIVE_LIMIT } from "../server/room-activity.js";
test("24小时有效操作清理与确认记录过期：自动保存和心跳没有touch路径",()=>{
 const db=new DatabaseSync(":memory:");try{db.exec("CREATE TABLE sessions(expires INTEGER)");
 const activity=new RoomActivity(db);activity.seed("room",1000);activity.seed("room",90000);
 assert.equal(activity.expired("room",1000+INACTIVE_LIMIT-1),false);assert.equal(activity.expired("room",1000+INACTIVE_LIMIT),true);
 activity.touch("room",2000);assert.equal(activity.expired("room",1000+INACTIVE_LIMIT),false);
 const legal=new LegalConsent(db);assert.equal(legal.valid(undefined),false);assert.equal(legal.valid("snake-consent=bad"),false);assert.throws(()=>legal.require(undefined));legal.prune(Date.now());
 }finally{db.close();}
});

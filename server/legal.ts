import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { LEGAL_VERSION } from "../shared/legal.js";
import { requireThat } from "./engine.js";
const DAY = 86400000;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class LegalConsent {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS legal_consents(hash TEXT PRIMARY KEY,version TEXT NOT NULL,accepted_at INTEGER NOT NULL);`);
  }
  token(cookie: string | undefined) {
    if (!cookie) return null;
    const value = cookie.split(";").map(c => c.trim()).find(c => c.startsWith("snake-consent="))?.slice(14);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  valid(cookie: string | undefined) {
    const token = this.token(cookie);
    if (!token) return false;
    const row = this.db.prepare("SELECT version,accepted_at FROM legal_consents WHERE hash=?").get(hash(token));
    return !!row && row.version === LEGAL_VERSION && Number(row.accepted_at) > Date.now() - 365 * DAY;
  }
  require(cookie: string | undefined) { requireThat(this.valid(cookie), "请先阅读并确认当前使用条款与隐私政策"); }
  prune(now: number) {
    this.db.prepare("DELETE FROM legal_consents WHERE accepted_at<?").run(now - 365 * DAY);
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
  }
  routes(app: Express) {
    const cookieOptions = (req: Request) => ({ httpOnly: true, sameSite: "lax" as const, secure: req.secure || process.env.NODE_ENV === "production", path: "/" });
    app.get("/api/legal/status", (req, res) => res.json({ version: LEGAL_VERSION, accepted: this.valid(req.headers.cookie) }));
    app.post("/api/legal/accept", (req, res) => {
      requireThat(req.body?.version === LEGAL_VERSION && req.body?.adult === true && req.body?.accepted === true, "请主动确认已成年并阅读当前版本条款");
      const token = randomBytes(32).toString("hex");
      const old = this.token(req.headers.cookie);
      if (old) this.db.prepare("DELETE FROM legal_consents WHERE hash=?").run(hash(old));
      this.db.prepare("INSERT INTO legal_consents VALUES(?,?,?)").run(hash(token), LEGAL_VERSION, Date.now());
      res.cookie("snake-consent", token, { ...cookieOptions(req), maxAge: 365 * DAY });
      res.json({ version: LEGAL_VERSION, accepted: true });
    });
    app.post("/api/legal/withdraw", (req: Request, res: Response) => {
      const token = this.token(req.headers.cookie);
      if (token) this.db.prepare("DELETE FROM legal_consents WHERE hash=?").run(hash(token));
      res.clearCookie("snake-consent", cookieOptions(req));
      res.json({ ok: true });
    });
  }
}

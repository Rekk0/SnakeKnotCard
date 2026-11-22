import { useState } from "react";
import type { RoomView } from "../shared/types";
import { ErrorNotice, Sheet } from "./components";

export default function HelpPanel({ room, action, onClose }: {
  room: RoomView;
  action: (type: string, data?: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (type: string, data: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { await action(type, data); if (type === "help") setSent(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const inbox = room.canControl || room.isOwner;
  return <Sheet title={inbox ? "私有求助" : "寻求帮助"} onClose={onClose}>
    {inbox ? <>
      <p className="sk-muted">仅原主持与当前控场可查看和处理。请先确认现场情况。</p>
      {room.helpRequests.length === 0 && <p>暂无求助。</p>}
      {[...room.helpRequests].reverse().map(h => <article className="help-item" key={h.id}>
        <strong>{room.players.find(p => p.id === h.playerId)?.name} · {h.category}</strong>
        <small>{new Date(h.at).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"})}</small>
        {h.reason && <p>{h.reason}</p>}
        {h.resolvedAt === null ? <button className="sk-button secondary small" disabled={busy}
          onClick={() => void submit("help-resolve", {helpId:h.id})}>已联系，当面处理完成</button> : <span className="sk-muted">已处理</span>}
      </article>)}
    </> : sent || room.ownHelpPending ? <div role="status" className="help-feedback">
      <h3>已静默通知主持人</h3><p>你的信息不会显示给其他玩家。请等待主持人联系。</p>
    </div> : <>
      <p className="sk-muted">静默发送给当前控场与原主持。原因可以不填。</p>
      <div className="help-options">{["受到骚扰", "希望停止当前任务", "身体不适", "其他"].map(c =>
        <button className={`sk-button secondary small ${category === c ? "selected" : ""}`} aria-pressed={category === c}
          key={c} onClick={() => setCategory(category === c ? "" : c)}>{c}</button>)}</div>
      <label className="sk-field-label">补充原因（可选）<textarea className="sk-field" rows={4} maxLength={300}
        value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="sk-button" disabled={busy} onClick={() => void submit("help", {category, reason})}>
        {busy ? "发送中…" : "静默发送"}</button>
    </>}
    <ErrorNotice message={error} />
  </Sheet>;
}

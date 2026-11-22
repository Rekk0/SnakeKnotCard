import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, ArrowLeft } from "lucide-react";
import { LEGAL_VERSION, CONTACT, OPERATOR, legalSections, legalTitles, type LegalKind } from "../shared/legal";
import { api } from "./api";
import { Brand, ErrorNotice } from "./components";
export function PolicyText({ kind, standalone = false }: { kind: LegalKind; standalone?: boolean }) {
  const Heading = standalone ? "h2" : "h3";
  return <article className="policy-text"><p className="sk-muted">版本 {LEGAL_VERSION} · 运营者 {OPERATOR}<br/><a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>{legalSections[kind].map(s => <section key={s.title}><Heading>{s.title}</Heading><p>{s.text}</p></section>)}</article>;
}
export function PolicyLinks() {
  return <nav className="policy-links" aria-label="条款与联系">{(Object.keys(legalTitles) as LegalKind[]).map(k => <a key={k} href={`/legal/${k}`} target="_blank" rel="noopener">{legalTitles[k]}</a>)}<a href="/legal/terms" target="_blank" rel="noopener">运营主体与联系</a></nav>;
}
export function FlowDialog({ title, children, footer, onClose, busy = false, className = "" }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const d = ref.current!; const before = document.activeElement as HTMLElement | null;
    const old = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    d.showModal();
    return () => { d.close(); document.documentElement.style.overflow = old; before?.focus(); };
  }, []);
  return <dialog ref={ref} className={`sk-sheet flow-dialog ${className}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="sheet-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}><X size={22}/></button></div>
    <div className="flow-body">{children}</div><div className="flow-footer">{footer}</div>
  </dialog>;
}
function PolicyPage({ kind }: { kind: LegalKind }) {
  const [error, setError] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  return <main className="policy-page"><Brand/><h1>{legalTitles[kind]}</h1><PolicyLinks/><PolicyText kind={kind} standalone/>
    <section><h2>浏览器确认与退出</h2><p>撤回后将退出当前浏览器身份并停止游戏连接。您仍可阅读公开政策。</p>
    <button className="sk-button secondary" disabled={busy || done} onClick={async () => { setBusy(true); try { await api("/api/legal/withdraw", null, {}); sessionStorage.removeItem("snake-session"); localStorage.setItem("snake-legal-withdrawn", String(Date.now())); setDone(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{done ? "已撤回浏览器确认" : busy ? "正在退出…" : "撤回确认并退出身份"}</button><ErrorNotice message={error}/></section><a className="sk-button" href="/">返回首页</a></main>;
}
export default function LegalGate({ children }: { children: ReactNode }) {
  const pathKind = location.pathname.startsWith("/legal/") ? location.pathname.slice(7) : null;
  const publicKind = pathKind && Object.hasOwn(legalTitles, pathKind) ? pathKind as LegalKind : null;
  const [status, setStatus] = useState<"checking" | "required" | "accepted" | "declined">("checking");
  const [kind, setKind] = useState<LegalKind | null>(null); const [adult, setAdult] = useState(false); const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (publicKind) return;
    let cancelled = false;
    api<{ accepted: boolean }>("/api/legal/status").then(r => { if (!cancelled) setStatus(r.accepted ? "accepted" : "required"); }).catch(e => { if (!cancelled) setError(e.message); });
    const onStorage = (event: StorageEvent) => { if (event.key === "snake-legal-withdrawn") { sessionStorage.removeItem("snake-session"); location.reload(); } };
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; window.removeEventListener("storage", onStorage); };
  }, [publicKind]);
  if (publicKind) return <PolicyPage kind={publicKind}/>;
  if (status === "accepted") return <>{children}</>;
  return <main className="consent-welcome"><Brand/><h1>欢迎来到蛇结。</h1><p className="sk-muted">入场前，请先了解参与约定与隐私保护。</p><PolicyLinks/><ErrorNotice message={error}/>
    {status === "checking" && <p role="status">{error ? "确认状态读取失败，请刷新重试。" : "正在读取浏览器确认状态…"}</p>}
    {status === "declined" && <><p>您尚未同意，未进入游戏。仍可阅读条款或联系我们。</p><button className="sk-button" onClick={() => setStatus("required")}>重新阅读与确认</button></>}
    {status === "required" && <FlowDialog title={kind ? legalTitles[kind] : "入场前，请阅读参与约定"} busy={busy} onClose={() => { if (kind) setKind(null); else setStatus("declined"); }} footer={kind ? <button className="sk-button secondary" onClick={() => setKind(null)}><ArrowLeft size={16}/>返回确认</button> : <><label className="legal-check"><input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)}/>我已满十八周岁。</label><label className="legal-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>我已阅读并同意使用条款，已阅读并理解隐私政策。</label><ErrorNotice message={error}/><div className="button-row"><button className="sk-button secondary" disabled={busy} onClick={() => setStatus("declined")}>不同意并退出</button><button className="sk-button" disabled={busy || !adult || !accepted} onClick={async () => { setBusy(true); setError(""); try { await api("/api/legal/accept", null, { version: LEGAL_VERSION, adult, accepted }); const check = await api<{ accepted: boolean }>("/api/legal/status"); if (!check.accepted) throw new Error("浏览器未保存必要Cookie，请允许本站Cookie后重试"); setStatus("accepted"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? "正在确认…" : "同意并进入"}</button></div></>}>
      {kind ? <PolicyText kind={kind}/> : <><p>游戏仅供现场成年人自愿参与。您可随时拒绝或停止任何互动，不得强迫饮酒或身体接触。</p><p>昵称、头像与游戏信息用于同桌互动；求助详情仅原主持和当前控场者可见。上传头像在本局结束时清理，连续24小时无操作的房间将被清理。</p><p>摄像头与头像上传由您主动选择。</p><nav className="policy-links">{(Object.keys(legalTitles) as LegalKind[]).map(k => <button className="sk-button secondary" key={k} onClick={() => setKind(k)}>阅读{legalTitles[k]}</button>)}</nav><p className="sk-muted">版本 {LEGAL_VERSION} · 运营主体与联系信息见条款详情。</p></>}
    </FlowDialog>}
  </main>;
}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Crown, X } from "lucide-react";
import { artUrl, effectDuration, type CardDefinition } from "../shared/cards";
import { Avatar } from "./components";
import "./effects-v3.css";

export { effectDuration };
export interface Preferences { sound: boolean; vibration: boolean; reduced: boolean; }
let audioContext: AudioContext | null = null;
export async function unlockAudio() {
  if (audioContext === null) audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("浏览器尚未允许声音，请再次点击音效开关");
}
export function feedback(prefs: Preferences, royal = false) {
  if (prefs.vibration && "vibrate" in navigator) navigator.vibrate(royal ? [50, 40, 100] : 35);
  if (!prefs.sound) return;
  if (audioContext === null || audioContext.state !== "running") throw new Error("音效尚未启用，请先点击声音开关");
  const audio = audioContext;
  const volume = audio.createGain();
  volume.gain.value = 0.045;
  volume.connect(audio.destination);
  (royal ? [261.63, 329.63, 392, 523.25] : [220, 330]).forEach((hz, i) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = hz;
    oscillator.connect(gain);
    gain.connect(volume);
    const start = audio.currentTime + i * .12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + .025);
    gain.gain.exponentialRampToValueAtTime(.001, start + .55);
    oscillator.start(start);
    oscillator.stop(start + .6);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
  setTimeout(() => volume.disconnect(), 1600);
}
/** 空串表示未遇能力限制；振动API返回成功也不证明设备真的震动。 */
export async function playDownAlert(prefs: Preferences): Promise<string> {
  const status: string[] = [];
  if (!prefs.vibration) status.push("振动已关闭");
  else if (!("vibrate" in navigator)) status.push("此浏览器不支持网页振动");
  else if (!navigator.vibrate([100, 60, 160])) status.push("浏览器未接受振动请求");
  status.push("文字提醒");
  return status.join("；");
}
export default function Effects({ card, name, avatar, prefs, preview = false, paused = false, remainingMs, onClose }: {
  card: CardDefinition; name: string; avatar: string; prefs: Preferences; preview?: boolean;
  paused?: boolean; remainingMs?: number; onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const dialog = useRef<HTMLDialogElement>(null);
  const remaining = useRef(remainingMs === undefined ? effectDuration(card.id) : remainingMs);
  const sounded = useRef(false);
  const [mediaError, setMediaError] = useState("");
  const royal = card.id === "c03";
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    remaining.current = remainingMs === undefined ? effectDuration(card.id) : remainingMs;
    sounded.current = false;
    setMediaError("");
  // remainingMs为本次挂载的起点；后续房间广播不能重播声音或重置本机动画。
  }, [card.id]);
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const timer = setTimeout(() => close.current(), Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [card.id, paused]);
  useEffect(() => {
    if (paused || sounded.current) return;
    let canceled = false;
    // StrictMode的首轮清理先发生，避免本地预览重复播放同一次声音。
    queueMicrotask(() => {
      if (canceled) return;
      sounded.current = true;
      try { feedback(prefs, royal); }
      catch (error) { setMediaError(error instanceof Error ? error.message : "声音播放失败"); }
    });
    return () => { canceled = true; };
  }, [card.id, paused, prefs.sound, prefs.vibration, royal]);
  return <dialog ref={dialog} className={`event-overlay v3-effect v3-effect-${card.id} motif-${card.motif} card-effect-${card.id} ${royal ? "is-royal" : "is-card-light"} ${prefs.reduced ? "is-reduced motion-reduced" : ""} ${paused ? "is-paused" : ""}`} aria-live="polite" aria-label={`${name}抽到了${card.name}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <button className="icon-button effect-close" onClick={onClose} aria-label="关闭本机动效"><X /></button>
    {preview && <span className="preview-label">动效预览 · 不计入牌局</span>}
    <div className="event-art"><img src={artUrl(card.id)} alt={royal ? `${card.name}卡面` : ""} /></div>
    {royal ? <>
      <div className="event-rays-frame" aria-hidden="true"><div className="event-rays" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--ray": i } as CSSProperties} />)}</div></div>
      <div className="event-orbits" aria-hidden="true"><span /><span /><span /></div>
      <div className="event-person">
        <div className="event-crown"><Crown strokeWidth={1.2} aria-hidden="true" /></div>
        <Avatar avatar={avatar} name={name} size="large" king />
      </div>
      <div className="event-copy v3-effect__copy"><span className="eyebrow">THE CORONATION</span><h2>{name}<br />已被加冕为王</h2><p>今夜，目光为你停留。</p></div>
    </> : <>
    <div className="card-lights" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
    <div className="v3-effect__body">
      <div className="v3-effect__card"><img src={artUrl(card.id)} alt={`${card.name}卡面`} /></div>
      <div className="v3-effect__identity">
        <span className="v3-effect__avatar"><Avatar avatar={avatar} name={name} size="large" /></span>
        <div className="v3-effect__copy"><span className="eyebrow">{card.name}</span><h2>{name}<br />{card.id === "c08" ? "已决心下海" : `抽到了${card.name}`}</h2></div>
      </div>
    </div>
    </>}
    <div className="event-particles" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <span key={i} style={{ "--particle": i } as CSSProperties} />)}</div>
    {mediaError && <p className="v3-effect__media-error" role="alert">{mediaError}</p>}
    <small className="v3-effect__hint">{paused ? "牌局已暂停" : "关闭仅跳过本机画面"}</small>
  </dialog>;
}

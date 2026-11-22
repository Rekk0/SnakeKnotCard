import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import { CARDS, artUrl } from "../shared/cards";
import { Ornament } from "./components";
import { PolicyLinks } from "./Legal";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function HomePage({onJoin,onHost,onCatalog,onReturn,reduced}: {
  onJoin:()=>void; onHost:()=>void; onCatalog:()=>void; onReturn?:()=>void;
  reduced: boolean;
}) {
  const [order] = useState(() => {
    const cards = [...CARDS];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  });
  const rail = useRef<HTMLDivElement>(null);
  const metrics = useRef({ step: 0, first: 0, width: 0, cardWidth: 0 });
  const anchor = useRef(0);
  const frame = useRef(0);
  const normalize = useRef(() => {});
  const cancelMove = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  const interactionUntil = useRef(0);
  const pointerHeld = useRef(false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const looping = !reduced && !systemReduced;
  useLayoutEffect(() => {
    const element = rail.current!;
    const cards = Array.from(element.querySelectorAll<HTMLElement>(".hero-gallery-card"));
    let initialized = false;
    const paint = () => {
      const { step, first, width } = metrics.current;
      if (element.clientWidth !== width || Math.abs(cards[0].getBoundingClientRect().width - metrics.current.cardWidth) > .1) return;
      const center = element.scrollLeft + width / 2;
      anchor.current = Math.round((center - first) / step);
      cards.forEach((card, i) => {
        const distance = Math.abs(first + i * step - center) / step;
        card.style.setProperty("--gallery-opacity", String(Math.max(.22, 1 - .72 * distance)));
      });
    };
    normalize.current = () => {
      if (!looping || frame.current || pointerHeld.current) return;
      const { step, first, width } = metrics.current;
      if (element.clientWidth !== width || Math.abs(cards[0].getBoundingClientRect().width - metrics.current.cardWidth) > .1) return;
      const index = Math.round((element.scrollLeft + width / 2 - first) / step);
      if (index < order.length || index >= order.length * 2) {
        const logical = ((index % order.length) + order.length) % order.length;
        element.scrollLeft += (order.length + logical - index) * step;
      }
      paint();
    };
    const resize = () => {
      cancelMove();
      const index = initialized ? anchor.current : looping ? order.length : 0;
      const bounds = element.getBoundingClientRect();
      const firstCard = cards[0].getBoundingClientRect();
      metrics.current = { step: cards[1].getBoundingClientRect().left - firstCard.left, first: firstCard.left - bounds.left + element.scrollLeft + firstCard.width / 2, width: element.clientWidth, cardWidth: firstCard.width };
      const { step, first, width } = metrics.current;
      element.scrollLeft = first + index * step - width / 2;
      initialized = true;
      paint();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    observer.observe(cards[0]);
    element.addEventListener("scroll", paint, { passive: true });
    const settle = () => normalize.current();
    element.addEventListener("scrollend", settle);
    return () => { observer.disconnect(); element.removeEventListener("scroll", paint); element.removeEventListener("scrollend", settle); cancelMove(); };
  }, [looping, order]);
  useEffect(() => {
    const element = rail.current;
    if (!element || !looping) return;
    const timer = setInterval(() => {
      const bounds = element.getBoundingClientRect();
      if (document.hidden || bounds.bottom <= 0 || bounds.top >= innerHeight || pointerHeld.current || Date.now() < interactionUntil.current || element.matches(":focus-visible") || element.querySelector(":focus-visible")) return;
      normalize.current();
      const { step, first, width } = metrics.current;
      const start = element.scrollLeft;
      const index = Math.round((start + width / 2 - first) / step);
      const target = first + (index + 1) * step - width / 2;
      const started = performance.now();
      const move = (now: number) => {
        const currentBounds = element.getBoundingClientRect();
        if (document.hidden || currentBounds.bottom <= 0 || currentBounds.top >= innerHeight) { frame.current = 0; return; }
        const t = Math.min(1, (now - started) / 1100);
        const eased = t * t * t * (t * (t * 6 - 15) + 10);
        element.scrollLeft = start + (target - start) * eased;
        if (t < 1) frame.current = requestAnimationFrame(move);
        else { frame.current = 0; normalize.current(); }
      };
      frame.current = requestAnimationFrame(move);
    }, 2400);
    return () => { clearInterval(timer); cancelMove(); };
  }, [looping]);
  const pauseForInteraction = () => { cancelMove(); interactionUntil.current = Date.now() + 3000; };
  return <div className="home-snap" aria-label="蛇结首页">
    <section className="home-page home-hero" aria-labelledby="hero-title">
      <div className="hero-intro">
        <span className="eyebrow">蛇结酒吧 · 原创卡牌</span>
        <h1 id="hero-title">今夜，谁先入局。</h1>
        <div className="home-actions">
          <button className="sk-button" onClick={onJoin}>加入牌局<ArrowUpRight size={20}/></button>
          <button className="sk-button secondary" onClick={onHost}>主持人开局<ArrowRight size={20}/></button>
        </div>
        {onReturn && <button className="return-room" onClick={onReturn}>返回房间<ArrowRight size={16}/></button>}
      </div>
      <div ref={rail} className="hero-card-rail" aria-label="左右滑动浏览卡面" tabIndex={0} onPointerDown={() => { pointerHeld.current = true; pauseForInteraction(); }} onPointerUp={() => { pointerHeld.current = false; pauseForInteraction(); }} onPointerCancel={() => { pointerHeld.current = false; pauseForInteraction(); }} onPointerLeave={() => { pointerHeld.current = false; pauseForInteraction(); }} onWheel={pauseForInteraction} onFocusCapture={pauseForInteraction}>
        {(looping ? [0, 1, 2] : [1]).flatMap(copy => order.map((c, i) => <button key={`${copy}-${c.id}`} data-card-id={c.id} data-copy={copy} className="hero-gallery-card" onClick={onCatalog} aria-label={`浏览${c.name}`} aria-hidden={copy !== 1 ? true : undefined} tabIndex={copy === 1 ? 0 : -1}>
          <img src={artUrl(c.id)} alt={c.name} loading={copy === 1 && i < 3 ? "eager" : "lazy"}/>
        </button>))}
      </div>
      <div className="home-hero-footer">
        <a className="next-home-page" href="#home-more" onClick={e => {e.preventDefault(); document.getElementById("home-more")?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});}}>更多<ArrowDown size={16}/></a>
      </div>
    </section>
    <section className="home-page home-more" id="home-more" aria-labelledby="more-title">
      <Ornament/>
      <span className="eyebrow">同桌，尽兴，也彼此尊重</span><h2 id="more-title">把手机留给抽牌，<br/>把今夜留给同桌。</h2>
      <button className="sk-button secondary" onClick={onCatalog}><BookOpen size={19}/>卡牌图鉴<ArrowUpRight size={18}/></button>
      <div className="home-info-grid">
        <div><h3>关于蛇结</h3><p>查看参与约定、隐私保护与联系渠道。</p><PolicyLinks/></div>
        <div><h3>参与约定</h3><p>自愿参与，随时可以拒绝或停止任务。请尊重他人边界，不强迫饮酒或身体接触；需要帮助时，可静默联系主持人。</p><p className="sk-muted">仅供现场成年人娱乐。上传头像在本局结束时清理；房间连续24小时无操作后清理。详情见隐私政策。</p></div>
      </div>
      <small className="home-colophon">蛇结酒吧 · SNAKE KNOT</small>
    </section>
  </div>;
}

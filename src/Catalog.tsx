import { useState } from "react";
import { ArrowUpRight, Play, BookOpen, LockKeyhole } from "lucide-react";
import { CARDS, artUrl, type CardDefinition } from "../shared/cards";
import { Back, Brand, ErrorNotice, Ornament, Sheet } from "./components";
import FullscreenButton from "./FullscreenButton";
import Effects, { type Preferences } from "./Effects";
export default function Catalog({
  onBack,
  prefs,
}: {
  onBack: () => void;
  prefs: Preferences;
}) {
  const [selected, setSelected] = useState<CardDefinition | null>(null);
  const [effect, setEffect] = useState<CardDefinition | null>(null);
  const [filter, setFilter] = useState("all");
  const [fullscreenError, setFullscreenError] = useState("");
  return (
    <div className="catalog-page">
      <header className="page-header">
        <Brand small />
        <nav><FullscreenButton onError={setFullscreenError} /><Back onClick={onBack} /></nav>
      </header>
      <main id="main-content">
        <ErrorNotice message={fullscreenError} />
        <div className="catalog-intro">
          <span className="eyebrow">THE DECK · 32 ORIGINAL ARTWORKS</span>
          <h1>
            每一张，
            <br />
            都有它的暗语。
          </h1>
          <p>蛇、玫瑰、荆棘与绳结。翻开今夜的全部可能。</p>
          <Ornament />
        </div>
        <div className="catalog-toolbar">
          <div className="segmented">
            <button
              className={filter === "all" ? "selected" : ""}
              onClick={() => setFilter("all")}
            >
              全部 32 张
            </button>
            <button
              className={filter === "ready" ? "selected" : ""}
              onClick={() => setFilter("ready")}
            >
              可测试 {CARDS.filter((c) => c.ready).length} 张
            </button>
          </div>
          <small>其余机制待完善</small>
        </div>
        <div className="catalog-grid">
          {CARDS.filter((c) => filter === "all" || c.ready).map(
            (card, index) => (
              <button
                className="catalog-card"
                key={card.id}
                onClick={() => setSelected(card)}
                style={
                  { "--stagger": Math.min(index, 5) } as React.CSSProperties
                }
              >
                <div className="catalog-art">
                  <img
                    src={artUrl(card.id)}
                    alt={`${card.name}原创版画图案`}
                    loading="lazy"
                  />
                  <span className="card-index sk-num">
                    {card.id.slice(1)} / 32
                  </span>
                  <ArrowUpRight className="catalog-arrow" size={20} />
                </div>
                <div className="catalog-caption">
                  <h2>{card.name}</h2>
                  <p>{card.subtitle}</p>
                  <span className={`card-state ${card.ready ? "ready" : ""}`}>
                    {card.ready ? (
                      <>
                        <Play size={12} />
                        已确认规则
                      </>
                    ) : (
                      <>
                        <LockKeyhole size={12} />
                        机制待定
                      </>
                    )}
                  </span>
                </div>
              </button>
            ),
          )}
        </div>
      </main>
      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <img
            className="detail-art"
            src={artUrl(selected.id)}
            alt={`${selected.name}卡面`}
          />
          <p className="sk-label">
            {selected.ready
              ? "已确认玩法"
              : "已完成插画 · 正式机制待完善"}
          </p>
          <p>{selected.rules}</p>
          <button
            className="sk-button"
            onClick={() => {
              setEffect(selected);
              setSelected(null);
            }}
          >
            <Play size={18} />
            预览揭牌效果
          </button>
          <p className="sk-muted">
            <BookOpen size={15} />
            预览不会启用卡牌，也不会产生抽牌记录。
          </p>
        </Sheet>
      )}
      {effect && (
        <Effects
          card={effect}
          name="预览玩家"
          avatar="c03"
          prefs={prefs}
          preview
          onClose={() => setEffect(null)}
        />
      )}
    </div>
  );
}

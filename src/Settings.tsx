import { CARDS, artUrl } from "../shared/cards";
import type { GameSettings } from "../shared/types";
export default function Settings({
  value,
  onChange,
  disabled = false,
}: {
  value: GameSettings;
  onChange: (s: GameSettings) => void;
  disabled?: boolean;
}) {
  const update = (id: string, patch: object) =>
    onChange({
      ...value,
      config: { ...value.config, [id]: { ...value.config[id], ...patch } },
    });
  const total=CARDS.reduce((n,c)=>n+value.config[c.id].count,0);
  return (
    <div className="settings-form">
      <label className="sk-field-label">抽牌方式
        <select className="sk-field" value={value.drawMode} disabled={disabled}
          onChange={e => onChange({...value, drawMode: e.target.value as GameSettings["drawMode"]})}>
          <option value="player">轮到的玩家点击抽牌</option>
          <option value="host">当前控场者为玩家抽牌</option>
        </select>
      </label>
      <label className="sk-field-label">
        配置名称
        <input
          className="sk-field"
          value={value.name}
          maxLength={32}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <div className="field-pair">
        <label className="sk-field-label">
          抽牌方向
          <select
            className="sk-field"
            value={value.direction}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                direction: Number(e.target.value) as 1 | -1,
              })
            }
          >
            <option value="1">顺时针</option>
            <option value="-1">逆时针</option>
          </select>
        </label>
        <label className="sk-field-label">
          桌面形状
          <select
            className="sk-field"
            value={value.layout}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                layout: e.target.value as GameSettings["layout"],
              })
            }
          >
            <option value="oval">长椭圆桌</option>
            <option value="round">圆桌</option>
            <option value="long">长桌</option>
          </select>
        </label>
      </div>
      <p className="sk-muted">抽完整副结束 · 0张不加入牌池</p>
      <div className="section-title">
        <h3>本局卡组</h3>
        <span>
          {total} 张 · {CARDS.filter(c=>value.config[c.id].count>0).length} 种
        </span>
      </div>
      {CARDS.map((card) => {
        const cfg = value.config[card.id];
        return (
          <div
            className={`config-card ${!card.ready ? "not-ready" : ""}`}
            key={card.id}
          >
            <div className="config-card-head">
              <img src={artUrl(card.id)} alt="" loading="lazy" />
              <div>
                <strong>{card.name}</strong>
                <small>
                  {card.ready ? "已确认规则" : "机制待完善，暂不可启用"}
                </small>
              </div>
              <label className="card-count-input">
                张数
                <input type="number" aria-label={`${card.name}张数`} min={0} max={100} value={cfg.count} disabled={disabled||!card.ready} onChange={e=>update(card.id,{count:Number(e.target.value)})}/>
              </label>
            </div>
          </div>
        );
      })}
      <p className="sk-muted">
        每张实体牌抽出后不放回。主持跳过任务也不会退牌。
      </p>
    </div>
  );
}

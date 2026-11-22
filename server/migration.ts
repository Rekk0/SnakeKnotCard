import { CARDS } from "../shared/cards.js";
import { requireThat } from "./validation.js";
import type { GameSettings } from "../shared/types.js";

export function migrateSettings(value: unknown):GameSettings {
  requireThat(value && typeof value==="object","旧配置为空，无法迁移");
  const s=value as Record<string,unknown>;
  requireThat(s.config && typeof s.config==="object","旧配置缺少卡组");
  const config=s.config as Record<string,Record<string,unknown>>;
  const next:GameSettings["config"]={};
  for(const card of CARDS){
    const c=config[card.id];requireThat(c&&typeof c==="object",`${card.name}缺少配置，需重新设置`);
    requireThat(c.mode!=="probability",`${card.name}使用旧概率模式，请先在旧版重新配置为有限张数，不从权重猜牌数`);
    requireThat(typeof c.count==="number"&&Number.isInteger(c.count)&&c.count>=0&&c.count<=100,`${card.name}张数无效，迁移已停止`);
    if(Object.hasOwn(c,"mode")||Object.hasOwn(c,"enabled")){
      requireThat(c.mode==="finite"&&typeof c.enabled==="boolean",`${card.name}旧抽取设置无效`);
      next[card.id]={count:c.enabled?c.count:0};
    }else{
      requireThat(Object.keys(c).length===1,`${card.name}卡组字段不受支持`);next[card.id]={count:c.count};
    }
    requireThat(card.ready||next[card.id].count===0,`${card.name}机制未定，不能通过迁移启用`);
  }
  const drawMode=s.drawMode===undefined?"player":s.drawMode;
  requireThat(drawMode==="player"||drawMode==="host","旧抽牌操作方式无效");
  requireThat(typeof s.name==="string"&&s.name.length>0,"旧配置名称无效");
  requireThat(s.direction===1||s.direction===-1,"旧抽牌方向无效");
  requireThat(s.layout==="round"||s.layout==="oval"||s.layout==="long","旧桌形无效");
  return {name:s.name,drawMode,direction:s.direction,layout:s.layout,config:next};
}

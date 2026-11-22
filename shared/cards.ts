import rules from "./card-rules.json" with { type: "json" };
export type Motif =
  | "tear"
  | "pulse"
  | "crown"
  | "gates"
  | "swap"
  | "mask"
  | "heart"
  | "rose"
  | "shield"
  | "clock"
  | "chain"
  | "key"
  | "petals"
  | "auction"
  | "garden"
  | "clash"
  | "hound"
  | "wave"
  | "letter"
  | "fork"
  | "lion"
  | "candle"
  | "fall"
  | "circle"
  | "prism";
export interface CardDefinition {
  completion?: "host_confirm" | "after_reveal" | "seat_swap" | "interactive";
  id: string;
  name: string;
  subtitle: string;
  motif: Motif;
  ready: boolean;
  brief: string;
  rules: string;
  effect?: string;
  effectScope: "all" | "player";
  effectMs: number;
  defaultCount: number;
  held?: boolean;
}
const motifs: Motif[] = [
  "tear",
  "pulse",
  "crown",
  "gates",
  "swap",
  "mask",
  "heart",
  "rose",
  "shield",
  "shield",
  "clock",
  "chain",
  "rose",
  "mask",
  "key",
  "petals",
  "wave",
  "auction",
  "chain",
  "garden",
  "petals",
  "clash",
  "hound",
  "wave",
  "heart",
  "letter",
  "fork",
  "lion",
  "candle",
  "fall",
  "circle",
  "prism",
];
const subtitles = [
  "纸间暗语",
  "逢七止声",
  "今夜的王",
  "层层入局",
  "座次流转",
  "面具之后",
  "以花为信",
  "玫瑰之约",
  "致意此刻",
  "借一份力量",
  "让此刻停留",
  "环环相扣",
  "荆棘之面",
  "月影之面",
  "执掌钥匙",
  "花瓣之外",
  "杯沿之间",
  "聚光之下",
  "相连的环",
  "园中有谁",
  "花落谁家",
  "正面交锋",
  "小犬纹章",
  "声声入耳",
  "玫瑰靠近",
  "交换一封信",
  "分岔花枝",
  "狮心之约",
  "今夜寿星",
  "暂停低头",
  "圈中同类",
  "三词寻人",
];
const durations: Record<string,number> = { c03:4200,c04:5000,c07:4200,c08:5000,c12:3600,c13:3400,c14:3400,c15:3800,c18:4800,c23:3800,c29:3600,c30:3800 };
export const effectDuration = (id: string) => durations[id] ?? 1500;
const held = new Set(["c03","c08","c10","c13","c14","c15","c28","c30"]);
const interactive = new Set(["c04","c08","c12","c21","c32"]);
const corrections: Record<string,string> = {
 c03:"国王只在线下修改规则，不获得网页控场权；M免受国王影响。",
 c04:"可选线上/线下；A最大2最小，无王，同点失败。每张新牌替换当前格，失败保留五格从第一格重来。最多错5轮，累计5罚后失败结束，不追加惩罚；成功也显示此前罚次。",
 c05:"由抽得者选择两名已入座参玩者；现场换好后由主持在应用确认，座次自动交换，持有牌跟人走。",
 c08:"输入1–10个汉字或英文字母（不允许数字、空格和其他字符）。昵称仅本人、原主持和当前控场可见。提交前跳过保留旧小姐，提交后宣告完自动下一位。",
 c10:"一次使用一张，允许叠加；老板指现场最高消费者。老板同意并完成后主持确认核销，拒绝不核销、原罚保留。",
 c12:"连结支持多人网络，共享身份、持续主动权限、约束和惩罚，不共享单次道具。禁止使S/M冲突的连接；抽到相反身份先解除抽牌者所有连结，再赋予新身份。",
 c13:"S/M直接及共享身份都互斥；新同名替换旧主。抽到相反角色先解除自己的连结、撤销自己旧异类身份再生效。",
 c14:"S/M直接及共享身份都互斥；新同名替换旧主。抽到相反角色先解除自己的连结、撤销自己旧异类身份再生效。",
 c16:"发现擦边即归零并受罚一次，后续重计10条；仅首次零重置成功可指定另一人受罚一次。现场判断。",
 c18:"未拍出的模子、未拍得模子的参与者，两类都受罚。拍卖在线下完成。",
 c19:"手铐完全线下执行，无软件关系登记，不共享任何身份、权限或惩罚。",
 c21:"主持选择软件计时或完全线下自计。软件随机10–30秒隐藏计时，爆炸后主持登记持物者并确认；自计无需软件计时、引爆或登记。",
 c23:"只执行本轮，不留持续身份。拒绝喝最终拍得者出价酒量；无人竞拍时抽得者受罚一次。",
 c28:"同一原始惩罚，全场合计最多加罚一次，不无限触发。",
 c30:"持有人或连结共享者可在我的卡牌选人点名。目标收到文字及其设备允许的震动、下头语音，同一目标冷却60秒。不能检测手机其他应用。",
 c31:"人数最少的类别全部受罚，并列最少（包括全员并列）也全部受罚。",
 c32:"出题者先秘密点选答案，其他每人一次提交猜测，全员提交才揭晓。猜错者受罚一次。三个词现场说；主持代填答案时退出本题猜测。"
};
export const CARDS: CardDefinition[] = rules.map((row,i) => ({
 id:row.id, name:row.name, subtitle:subtitles[i], motif:motifs[i], ready:row.rules !== null,
 rules:row.rules === null ? "机制尚未确定，暂不可加入牌局。" : row.rules + (corrections[row.id] ? "\n"+corrections[row.id] : ""),
 brief: row.id === "c05" ? "抽得者选两人，主持确认现场换座。" : row.rules === null ? "机制待确定" : row.rules.split(/[。；]/)[0],
 effect:row.effect === null ? undefined : row.effect, effectScope:row.effectScope === "全场" ? "all" : "player",
 effectMs:effectDuration(row.id),defaultCount:row.defaultCount,held:held.has(row.id),
 completion: row.id === "c05" ? "seat_swap" : interactive.has(row.id) ? "interactive" : held.has(row.id) ? "after_reveal" : "host_confirm"
}));
export const cardById = (id: string): CardDefinition => {
  const card = CARDS.find((c) => c.id === id);
  if (!card) throw new Error("卡牌不存在");
  return card;
};
export const AVATARS = ["c03", "c07", "c11", "c15", "c20", "c23", "c28", "c32"];
export const artUrl = (id: string) => `/art/cards/${id}.webp`;

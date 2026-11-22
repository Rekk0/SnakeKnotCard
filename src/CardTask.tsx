import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../shared/types";
import { Avatar, ErrorNotice } from "./components";
import Table from "./Table";
import "./tasks.css";

type Action=(type:string,data?:Record<string,unknown>)=>Promise<void>;
export default function CardTask({room,action,busy,onDirtyChange}:{room:RoomView;action:Action;busy:boolean;onDirtyChange?:(dirty:boolean)=>void}){
  const [selected,setSelected]=useState<string[]>([]);
  const [nickname,setNickname]=useState(room.turn?room.nicknames[room.turn.playerId]??"":"");
  const [error,setError]=useState("");
  const [sending,setSending]=useState(false);
  const initialNickname=useRef(nickname);
  useEffect(()=>{
    onDirtyChange?.(nickname!==initialNickname.current||selected.length>0);
    return ()=>onDirtyChange?.(false);
  },[nickname,selected,onDirtyChange]);
  const t=room.turn, task=t?.task;
  if(!t||!task)return <p>本牌现场执行，完成后由主持确认。</p>;
  const players=room.players.filter(p=>p.approved&&!p.removed);
  const canAct=room.state==="running"&&!busy&&!sending;
  const canChoose=canAct&&(room.selfPlayerId===t.playerId||room.canControl);
  const canPick=canAct&&(task.kind==="flower"?room.canControl:task.kind==="guess"&&task.voters.length>0?!!room.selfPlayerId&&task.voters.includes(room.selfPlayerId)&&!task.excluded.includes(room.selfPlayerId)&&!Object.hasOwn(task.guesses,room.selfPlayerId):canChoose);
  const name=(id:string)=>players.find(p=>p.id===id)?.name??"已离场玩家";
  const send=async(type:string,data:Record<string,unknown>={})=>{setSending(true);setError("");try{await action(type,data);setSelected([]);}catch(e){setError((e as Error).message);}finally{setSending(false);}};
  const connectionError=(id:string)=>{
    if(task.kind!=="link")return "";
    if(id===t.playerId)return "不能与自己连结";
    if(room.links.some(e=>(e.a===id&&e.b===t.playerId)||(e.b===id&&e.a===t.playerId)))return "已有直接连结，可在下方解除";
    const roles=new Set(room.identities.filter(h=>h.playerId===id||h.playerId===t.playerId).map(h=>h.cardId));
    return roles.has("c13")&&roles.has("c14")?"S/M身份冲突，不能连结":"";
  };
  const pick=(id:string)=>{
    const reason=connectionError(id);
    if(reason||task.kind==="guess"&&id===t.playerId){setError(reason||"请选择出题者以外的玩家");return;}
    setError("");setSelected(list=>task.kind==="swap"?(list.includes(id)?list.filter(x=>x!==id):[...list.slice(-1),id]):[id]);
  };
  const options=(excludeSource=false)=> <div className="task-player-options">{players.filter(p=>!excludeSource||p.id!==t.playerId).map(p=><button type="button" key={p.id} aria-label={p.name} aria-pressed={selected.includes(p.id)} className={`task-player ${selected.includes(p.id)?"selected":""}`} disabled={!canPick||!!connectionError(p.id)} title={connectionError(p.id)} onClick={()=>pick(p.id)}><Avatar avatar={p.avatar} name={p.name} size="small"/><span>{p.name}{connectionError(p.id)&&<small>{connectionError(p.id)}</small>}</span></button>)}</div>;
  return <div className="card-task">
    <p className="sk-muted">本牌属于 <strong>{name(t.playerId)}</strong>{room.selfPlayerId===t.playerId?" · 轮到你操作":" · 按提示等待或参与，主持可协助"}</p>
    {task.kind==="nickname"&&<form onSubmit={e=>{e.preventDefault();void send("nickname",{nickname});}}>
      <label className="sk-field-label">设置你的小姐昵称<input className="sk-field" value={nickname} maxLength={20} disabled={!canChoose} onChange={e=>setNickname(e.target.value)} autoComplete="off"/></label>
      <p className="sk-muted">1–10个汉字或英文字母，仅你和主持可见。提交后替换旧小姐。</p>
      <button className="sk-button" disabled={!canChoose}>{sending?"提交中…":"确认昵称并登场"}</button>
    </form>}
    {(task.kind==="gates-mode"||task.kind==="flower-mode")&&<><p>请主持选择本轮执行方式</p><div className="task-actions"><button className="sk-button" disabled={!canAct||!room.canControl} onClick={()=>void send("task-mode",{mode:"online"})}>使用软件{task.kind==="flower-mode"?"计时":"执行"}</button><button className="sk-button secondary" disabled={!canAct||!room.canControl} onClick={()=>void send("task-mode",{mode:"offline"})}>完全线下执行</button></div></>}
    {task.kind==="swap"&&<><p>抽得者选两人；现场换好后，主持再确认。</p>{options()}
      <button className="sk-button" disabled={!canChoose||selected.length!==2} onClick={()=>void send("swap-select",{players:selected})}>提交这两位玩家</button>
      {task.players.length===2&&<div className="task-result"><strong>{task.players.map(name).join(" ↔ ")}</strong><button className="sk-button" disabled={!canAct||!room.canControl} onClick={()=>void send("seat-swap",{seatA:room.seats.find(s=>s.playerId===task.players[0])?.id,seatB:room.seats.find(s=>s.playerId===task.players[1])?.id})}>已实际换座，确认更新位置</button></div>}
    </>}
    {task.kind==="link"&&<><p>选择另一位玩家建立连结，或解除一条现有连结。不能让S/M进入同一网络。</p>{options(true)}
      <button className="sk-button" disabled={!canChoose||selected.length!==1||task.done} onClick={()=>void send("link",{operation:"connect",playerId:selected[0]})}>与选中玩家连结</button>
      {room.links.length>0&&<div className="task-link-list">{room.links.map(edge=><button className="tool-button" key={edge.id} disabled={!canChoose||task.done} onClick={()=>void send("link",{operation:"disconnect",linkId:edge.id})}>解除 {name(edge.a)} ↔ {name(edge.b)}</button>)}</div>}
    </>}
    {task.kind==="gates"&&<><p className="sk-num">第 {Math.min(task.position+1,5)} 关 · 已受罚 {task.failures} 次 / 最多5次</p><div className="poker-board">{task.board.map((card,i)=><div key={i} className={`poker-card ${i===task.position?"current":""} ${card.suit===1||card.suit===2?"red":""}`}><small>{i+1}</small><strong>{({11:"J",12:"Q",13:"K",14:"A"} as Record<number,string>)[card.rank]??card.rank}</strong><span>{["♠","♥","♦","♣"][card.suit]}</span></div>)}</div>
      {task.outcome==="playing"?<><p>猜下一张比当前高亮牌更大还是更小；同点也算失败。</p><div className="task-actions"><button className="sk-button" disabled={!canChoose} onClick={()=>void send("gate-guess",{direction:"higher"})}>更大</button><button className="sk-button secondary" disabled={!canChoose} onClick={()=>void send("gate-guess",{direction:"lower"})}>更小</button></div></>:<div className="task-result" role="status"><h3>{task.outcome==="won"?"五关全过":"已达到5轮错误上限"}</h3><strong>本次累计受罚 {task.failures} 次</strong><p>等待主持确认下一位</p></div>}
    </>}
    {task.kind==="flower"&&<><div className={`flower-state ${task.exploded?"exploded":""}`} role="status"><strong>{task.exploded?"爆炸！":"正在传花"}</strong><p>{task.exploded?"请主持确认爆炸时持物者，受罚一次。":"现场传递物品，爆点随机，剩余秒数不公开。"}</p></div>
      {task.exploded&&<>{options()}<button className="sk-button" disabled={!canAct||!room.canControl||selected.length!==1} onClick={()=>void send("flower-result",{playerId:selected[0]})}>登记持物者</button>{task.holderId&&<p>已登记：{name(task.holderId)} · 等待主持确认下一位</p>}</>}
    </>}
    {task.kind==="guess"&&<>
      {task.cancelled?<p role="status">出题者或答案目标已离场，本题取消，不判罚。</p>:task.revealed?<div className="task-result"><h3>答案：{task.answerId?name(task.answerId):"本题已取消"}</h3>{task.voters.map(id=><p key={id}>{name(id)}：{task.excluded.includes(id)?"已排除，不判罚":task.guesses[id]===task.answerId?"猜对":`猜错，受罚一次（选了${name(task.guesses[id])}）`}</p>)}<p>等待主持确认下一位</p></div>:!task.voters.length?<><p>出题者先秘密选中一位其他玩家，提交后在现场说三个词。</p>{canChoose&&<>{options(true)}<button className="sk-button" disabled={selected.length!==1||!canChoose} onClick={()=>void send("guess-answer",{playerId:selected[0],assist:room.selfPlayerId!==t.playerId})}>{room.selfPlayerId===t.playerId?"秘密提交答案":"代填答案，并退出本题猜测"}</button></>}</>:<><p className="sk-num">已提交 {Object.keys(task.guesses).length} / {task.voters.filter(id=>!task.excluded.includes(id)).length} 人，交齐后统一揭晓。</p>
      {room.selfPlayerId&&task.voters.includes(room.selfPlayerId)&&!task.excluded.includes(room.selfPlayerId)&&!Object.hasOwn(task.guesses,room.selfPlayerId)?<>{options(true)}<button className="sk-button" disabled={!canAct||selected.length!==1} onClick={()=>void send("guess-submit",{playerId:selected[0]})}>锁定我的猜测（仅一次）</button></>:<p>等待其他玩家提交，答案尚未揭晓。</p>}
      {room.canControl&&task.voters.filter(id=>!Object.hasOwn(task.guesses,id)&&!task.excluded.includes(id)).map(id=><button className="tool-button" disabled={!canAct} key={id} onClick={()=>void send("guess-exclude",{playerId:id})}>明确排除本题：{name(id)}（不判错）</button>)}
      </>}
    </>}
    {(task.kind==="swap"||task.kind==="link"||task.kind==="guess")&&<details open><summary>现场桌图 · 点头像选择玩家</summary><Table room={room} onSeat={seat=>{if(seat.playerId&&canPick)pick(seat.playerId);}}/></details>}
    <ErrorNotice message={error}/>
    {room.canControl&&<div className="task-actions"><button className="tool-button" disabled={busy||sending} onClick={()=>void send(room.state==="paused"?"resume":"pause")}>{room.state==="paused"?"继续牌局":"暂停牌局"}</button>{((task.kind==="gates"&&task.outcome!=="playing")||(task.kind==="flower"&&task.holderId)||(task.kind==="guess"&&(task.revealed||task.cancelled)))&&<button className="sk-button" disabled={!canAct} onClick={()=>void send("settle",{result:"软件任务已完成，主持确认"})}>确认结果，下一位</button>}</div>}
  </div>;
}

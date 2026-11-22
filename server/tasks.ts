import { randomInt } from "node:crypto";
import type { CardTask, PokerCard } from "../shared/types.js";
import { requireThat } from "./validation.js";

export function shuffled<T>(items:T[], random:(max:number)=>number=randomInt):T[] {
  const next=[...items];
  for(let i=next.length-1;i>0;i--){const j=random(i+1); requireThat(Number.isInteger(j)&&j>=0&&j<=i,"随机结果越界");[next[i],next[j]]=[next[j],next[i]];}
  return next;
}
export function gates():Extract<CardTask,{kind:"gates"}> {
  const deck=shuffled(Array.from({length:52},(_,id)=>({id,rank:2+id%13,suit:Math.floor(id/13)})));
  return {kind:"gates",board:deck.splice(0,5),deck,discard:[],position:0,failures:0,outcome:"playing"};
}
export function guessGate(task:Extract<CardTask,{kind:"gates"}>, direction:unknown) {
  requireThat(task.outcome==="playing","本次过5关已经结束");
  requireThat(direction==="higher"||direction==="lower","请选择大或小");
  if(!task.deck.length){ requireThat(task.discard.length>0,"扑克牌堆与弃牌均为空");task.deck=shuffled(task.discard);task.discard=[]; }
  const card=task.deck.pop()!;
  const old=task.board[task.position];
  const correct=direction==="higher"?card.rank>old.rank:card.rank<old.rank;
  task.board[task.position]=card;task.discard.push(old);
  if(correct){task.position++;if(task.position===5)task.outcome="won";}
  else {task.failures++;task.position=0;if(task.failures===5)task.outcome="lost";}
}
export function revealIfReady(task:Extract<CardTask,{kind:"guess"}>) {
  if(task.answerId && task.voters.every(id=>task.excluded.includes(id)||Object.hasOwn(task.guesses,id)))task.revealed=true;
}

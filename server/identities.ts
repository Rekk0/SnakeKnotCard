import { randomUUID } from "node:crypto";
import type { Room, SharedIdentity } from "../shared/types.js";
import { requireThat } from "./validation.js";

export function network(room: Room, playerId: string): Set<string> {
  const found = new Set([playerId]);
  const pending = [playerId];
  while (pending.length) {
    const id = pending.pop()!;
    for (const edge of room.links) {
      const other = edge.a === id ? edge.b : edge.b === id ? edge.a : null;
      if (other && !found.has(other)) { found.add(other); pending.push(other); }
    }
  }
  return found;
}
export function identities(room: Room): SharedIdentity[] {
  const result: SharedIdentity[] = [];
  for (const held of room.held) {
    const members = held.cardId === "c10" ? [held.playerId] : network(room, held.playerId);
    for (const playerId of members) result.push({cardId:held.cardId,playerId,sourcePlayerId:held.playerId,heldId:held.id,shared:playerId!==held.playerId});
  }
  return result;
}
export function grant(room: Room, cardId: string, playerId: string) {
  if (cardId === "c13" || cardId === "c14") {
    const opposite = cardId === "c13" ? "c14" : "c13";
    if (identities(room).some(h=>h.playerId===playerId && h.cardId===opposite)) {
      room.links=room.links.filter(e=>e.a!==playerId && e.b!==playerId);
      room.held=room.held.filter(h=>!(h.playerId===playerId && h.cardId===opposite));
    }
  }
  if (cardId !== "c10") room.held=room.held.filter(h=>h.cardId!==cardId);
  room.held.push({id:randomUUID(),cardId,playerId});
  if (cardId === "c03") room.kingId=playerId;
  if (cardId === "c08") for(const id of Object.keys(room.nicknames)) if(id!==playerId) delete room.nicknames[id];
}
export function connect(room: Room, a: string, b: string) {
  requireThat(a!==b,"不能与自己连结");
  requireThat(!room.links.some(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a)),"两人已有直接连结");
  const members=new Set([...network(room,a),...network(room,b)]);
  const roles=new Set(room.held.filter(h=>members.has(h.playerId)).map(h=>h.cardId));
  requireThat(!(roles.has("c13") && roles.has("c14")),"这条连结会使S与M身份冲突，请选择其他玩家");
  room.links.push({id:randomUUID(),a,b});
}
export function removeIdentityPlayer(room: Room, id: string) {
  room.links=room.links.filter(e=>e.a!==id&&e.b!==id);
  room.held=room.held.filter(h=>h.playerId!==id);
  delete room.nicknames[id];
  room.cardUses=room.cardUses.filter(u=>u.playerId!==id&&room.held.some(h=>h.id===u.heldId));
  if(room.kingId===id)room.kingId=null;
}

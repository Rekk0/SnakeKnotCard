export interface Actor {
  id: string;
  kind: "host" | "player";
  roomCode?: string;
}
export interface Player {
  id: string;
  name: string;
  avatar: string;
  approved: boolean;
  removed: boolean;
  online: boolean;
  joinedAt: number;
}
export interface Seat {
  id: string;
  kind: "host" | "player" | "empty" | "spectator";
  playerId?: string;
}
export interface CardConfig {
  count: number;
}
export type CardConfigs = Record<string, CardConfig>;
export interface GameSettings {
  drawMode: "player" | "host";
  name: string;
  config: CardConfigs;
  direction: 1 | -1;
  layout: "round" | "oval" | "long";
}
export interface Turn {
  autoAdvance?: boolean;
  id: string;
  playerId: string;
  anchorSeatId: string;
  phase: "draw" | "task";
  cardId?: string;
  targetId?: string;
  passingPlayerId?: string;
  deadline?: number;
  remainingMs?: number;
  choices: Record<string, string>;
  result?: string;
  task?: CardTask;
  effectAt?: number;
}
export interface PokerCard { id: number; rank: number; suit: number }
export type CardTask =
  | { kind: "nickname" }
  | { kind: "swap"; players: string[] }
  | { kind: "link"; done: boolean }
  | { kind: "gates-mode" }
  | { kind: "gates"; board: PokerCard[]; deck: PokerCard[]; discard: PokerCard[]; position: number; failures: number; outcome: "playing" | "won" | "lost" }
  | { kind: "flower-mode" }
  | { kind: "flower"; exploded: boolean; holderId: string | null }
  | { kind: "guess"; answerId: string | null; voters: string[]; guesses: Record<string,string>; excluded: string[]; helperId: string | null; revealed: boolean; cancelled: boolean };
export type CardTaskView = Exclude<CardTask, {kind: "gates"} | {kind: "guess"}> |
  Omit<Extract<CardTask,{kind:"gates"}>,"deck"|"discard"> |
  (Omit<Extract<CardTask,{kind:"guess"}>,"answerId"|"guesses"> & {answerId: string | null; guesses: Record<string,string>});
export interface SharedIdentity { cardId: string; playerId: string; sourcePlayerId: string; heldId: string; shared: boolean }
export interface Link { id: string; a: string; b: string }
export interface CardUse { id: string; heldId: string; playerId: string; at: number }
export interface AlertEvent { id: string; targetId: string; fromPlayerId: string; sourcePlayerId: string; at: number }
export interface GameLog {
  id: string;
  at: number;
  message: string;
  cardId?: string;
  playerId?: string;
}
export interface HeldCard {
  id: string;
  cardId: string;
  playerId: string;
}
export interface Room {
  schemaVersion: 3;
  pendingDrawMode: "player" | "host" | null;
  helpRequests: HelpRequest[];
  id: string;
  matchId: string;
  code: string;
  ownerId: string;
  ownerName: string;
  ownerOnline: boolean;
  controllerId: string;
  backupId: string | null;
  hostPlayerId: string | null;
  state: "lobby" | "running" | "paused" | "ended";
  pauseReason: string | null;
  accepting: boolean;
  settings: GameSettings;
  pendingDirection: 1 | -1 | null;
  players: Player[];
  seats: Seat[];
  pendingSeats: Seat[] | null;
  remaining: Record<string, number>;
  turn: Turn | null;
  drawCount: number;
  kingId: string | null;
  held: HeldCard[];
  links: Link[];
  nicknames: Record<string,string>;
  cardUses: CardUse[];
  alertCooldowns: Record<string,number>;
  alertEvent: AlertEvent | null;
  logs: GameLog[];
  createdAt: number;
  persistedAt: number;
  endedAt: number | null;
  endReason: string | null;
  version: number;
  appliedRequests: string[];
}
export interface HelpRequest {
  id: string;
  playerId: string;
  category: string;
  reason: string;
  at: number;
  resolvedAt: number | null;
}
export interface RoomView extends Omit<Room, "appliedRequests" | "helpRequests" | "nicknames" | "turn" | "alertCooldowns" | "alertEvent"> {
  turn: (Omit<Turn,"task"> & {task?: CardTaskView}) | null;
  nicknames: Record<string,string>;
  identities: SharedIdentity[];
  ownAlertCooldowns: Record<string,number>;
  helpRequests: HelpRequest[];
  backupHelpNotice: boolean;
  ownHelpPending: boolean;
  selfPlayerId: string | null;
  isOwner: boolean;
  canControl: boolean;
  serverTime: number;
}
export interface RoomAction {
  type: string;
  data?: Record<string, unknown>;
  requestId: string;
  matchId: string;
}
export interface StoredPreset {
  id: string;
  name: string;
  settings: GameSettings;
  updatedAt: number;
}
export interface Session {
  token: string;
  actor: Actor;
  roomCode?: string;
  avatarMatchId?: string;
}

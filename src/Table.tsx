import { Plus, UserRound, Armchair } from "lucide-react";
import type { RoomView, Seat } from "../shared/types";
import { Avatar } from "./components";
export default function Table({
  room,
  seats = room.seats,
  editable = false,
  onSeat,
  onInsert,
  selectable,
  selected,
}: {
  room: RoomView;
  seats?: Seat[];
  editable?: boolean;
  onSeat?: (seat: Seat) => void;
  onInsert?: (after: Seat, before: Seat) => void;
  selectable?: string[];
  selected?: string;
}) {
  const name = (seat: Seat) =>
    seat.playerId
      ? room.players.find((p) => p.id === seat.playerId)?.name
      : seat.kind === "host"
        ? room.ownerName
        : seat.kind === "spectator"
          ? "不参与"
          : "空位";
  return (
    <div className={`table-scroller layout-${room.settings.layout}`}>
      <div
        className="table-map"
        style={
          {
            "--table-height": `${Math.max(room.settings.layout === "round" ? 380 : 440, seats.length * 43)}px`,
          } as React.CSSProperties
        }
      >
        <div className="table-surface">
          <img src="/art/brand/logo.webp" alt="" />
          <span>{room.settings.direction === 1 ? "顺时针" : "逆时针"}抽牌</span>
          <small>以原主持人为 1 号位</small>
          {editable && onInsert && seats.length > 0 && (
            <button
              className="text-button table-add-position"
              onClick={() => onInsert(seats[seats.length - 1], seats[0])}
            >
              <Plus size={16} />
              添加位置
            </button>
          )}
        </div>
        {seats.map((seat, i) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * i) / seats.length;
          const x = 50 + 39 * Math.cos(angle);
          const y = 50 + 40 * Math.sin(angle);
          const person = room.players.find((p) => p.id === seat.playerId);
          const current = room.turn?.playerId === seat.playerId;
          const canClick =
            editable ||
            (person && (!selectable || selectable.includes(person.id)));
          return (
            <button
              key={seat.id}
              className={`table-seat ${current ? "is-current" : ""} ${selected === seat.playerId ? "is-selected" : ""} ${seat.kind === "spectator" || seat.kind === "empty" ? "seat-inactive" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => onSeat?.(seat)}
              disabled={!canClick}
              aria-label={`${i + 1}号位 ${name(seat)}${current ? " 正在抽牌" : ""}`}
            >
              <span className="seat-avatar">
                {person ? (
                  <Avatar
                    avatar={person.avatar}
                    name={person.name}
                    king={room.kingId === person.id} sharedKing={room.identities.some(h=>h.playerId===person.id&&h.cardId==="c03"&&h.shared)}
                  />
                ) : seat.kind === "host" ? (
                  <UserRound />
                ) : (
                  <Armchair />
                )}
                <span className="seat-number sk-num">{i + 1}</span>
              </span>
              <strong>{name(seat)}</strong>
              <small>
                {current
                  ? "当前玩家"
                  : seat.kind === "host"
                    ? room.hostPlayerId
                      ? "主持·参玩"
                      : "主持·控场"
                    : person && !person.online
                      ? "离线"
                      : seat.kind === "spectator"
                        ? "不参与"
                        : seat.kind === "empty"
                          ? "可添加"
                          : ""}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

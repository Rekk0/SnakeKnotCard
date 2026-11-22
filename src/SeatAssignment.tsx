import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Armchair, GripVertical, UserRound, X } from "lucide-react";
import type { RoomView, Seat } from "../shared/types";
import { Avatar, ErrorNotice } from "./components";

interface Props {
  room: RoomView;
  busy: boolean;
  onAssign: (playerId: string, afterId: string, beforeId: string) => Promise<void>;
}

export default function SeatAssignment({ room, busy, onAssign }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pointer = useRef<{ id: string; pointerId: number; x: number; y: number; dragging: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const players = room.players.filter((p) => p.approved && !p.removed);
  const enabled = room.state === "lobby" && room.canControl && !busy && !saving;
  const assignable = players.filter((p) => p.id !== room.hostPlayerId);
  // The insertion pair describes adjacency after removing the moving player's old seat.
  const destinations = room.seats.filter((seat) => !selected || seat.playerId !== selected);
  const selectedPlayer = players.find((p) => p.id === selected);
  const dragPlayer = players.find((p) => p.id === drag?.id);
  const assigned = new Set(room.seats.flatMap((seat) => seat.playerId ? [seat.playerId] : []));

  const cancel = () => {
    pointer.current = null;
    setDrag(null);
    setOver(null);
    setSelected(null);
  };
  const seatSignature = room.seats.map((seat) => `${seat.id}:${seat.playerId}`).join("|");
  useEffect(() => { cancel(); }, [seatSignature, room.state]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const name = (seat: Seat) => seat.playerId
    ? players.find((p) => p.id === seat.playerId)?.name
    : seat.kind === "host" ? room.ownerName : seat.kind === "spectator" ? "不参与" : "空位";
  const destinationAt = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-seat-after]");
    return element && root.current?.contains(element) ? element.dataset.seatAfter ?? null : null;
  };
  const assign = async (playerId: string, afterId: string) => {
    if (!enabled) return;
    const seats = room.seats.filter((seat) => seat.playerId !== playerId);
    const index = seats.findIndex((seat) => seat.id === afterId);
    if (index < 0) {
      setError("相邻位置已变化，请重新选择。");
      cancel();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAssign(playerId, afterId, seats[(index + 1) % seats.length].id);
      cancel();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    pointer.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    root.current?.setPointerCapture(event.pointerId);
  };

  return (
    <div
      ref={root}
      className={`seat-assignment ${drag ? "is-dragging" : ""}`}
      onPointerMove={(event) => {
        const current = pointer.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8) return;
        current.dragging = true;
        const scroller = root.current?.closest<HTMLDialogElement>("dialog");
        if (scroller) {
          const bounds = scroller.getBoundingClientRect();
          if (event.clientY > bounds.bottom - 64) scroller.scrollBy(0, 16);
          else if (event.clientY < bounds.top + 64) scroller.scrollBy(0, -16);
        }
        setSelected(current.id);
        setDrag({ id: current.id, x: event.clientX, y: event.clientY });
        setOver(destinationAt(event.clientX, event.clientY));
      }}
      onPointerUp={(event) => {
        const current = pointer.current;
        if (!current || current.pointerId !== event.pointerId) return;
        pointer.current = null;
        setDrag(null);
        setOver(null);
        if (current.dragging) {
          const afterId = destinationAt(event.clientX, event.clientY);
          if (afterId) void assign(current.id, afterId);
          else setSelected(null);
        } else setSelected((previous) => previous === current.id ? null : current.id);
      }}
      onPointerCancel={cancel}
    >
      <p className="table-hint">拖动头像到相邻座位之间。也可以先点玩家，再点插入位置。</p>
      <div className="seat-player-tray" aria-label="可安排的玩家">
        {assignable.map((player) => (
          <button
            type="button"
            key={player.id}
            className={`seat-player-chip ${selected === player.id ? "selected" : ""}`}
            disabled={!enabled}
            aria-pressed={selected === player.id}
            aria-label={`安排${player.name}，${assigned.has(player.id) ? "已入座" : "待安排"}`}
            onPointerDown={(event) => begin(event, player.id)}
            onClick={(event) => {
              if (event.detail === 0) setSelected((previous) => previous === player.id ? null : player.id);
            }}
          >
            <Avatar avatar={player.avatar} name={player.name} size="small" />
            <span>{player.name}<small>{assigned.has(player.id) ? "已入座" : "待安排"}</small></span>
            <GripVertical size={16} />
          </button>
        ))}
        {assignable.length === 0 && <p className="sk-muted">玩家入场后，在这里安排座次。</p>}
      </div>
      {selectedPlayer && (
        <div className="seat-selection-status" role="status">
          <span>正在安排：{selectedPlayer.name}</span>
          <button type="button" className="icon-button" aria-label="取消安排座次" onClick={cancel}><X size={18} /></button>
        </div>
      )}
      <ol className="seat-order-list" aria-label="从主持人开始的顺时针座次">
        {destinations.map((seat, index) => {
          const person = players.find((p) => p.id === seat.playerId);
          const next = destinations[(index + 1) % destinations.length];
          return (
            <li key={seat.id}>
              <div className="seat-order-row">
                <span className="sk-num">{index + 1}</span>
                {person ? <Avatar avatar={person.avatar} name={person.name} size="small" /> : seat.kind === "host" ? <UserRound size={24} /> : <Armchair size={24} />}
                <strong>{name(seat)}</strong>
                {seat.kind === "host" && <small>主持人 · 固定 1 号位</small>}
              </div>
              {selected && (
                <button
                  type="button"
                  className={`seat-drop-target ${over === seat.id ? "is-over" : ""}`}
                  data-seat-after={seat.id}
                  disabled={!enabled}
                  onClick={() => void assign(selected, seat.id)}
                  aria-label={`将${selectedPlayer?.name}放在${name(seat)}与${name(next)}之间`}
                >
                  放在{name(seat)}与{name(next)}之间
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sk-muted">编号顺时针排列；本局{room.settings.direction === 1 ? "顺时针" : "逆时针"}抽牌。</p>
      <ErrorNotice message={error} />
      {drag && dragPlayer && (
        <div className="seat-drag-preview" aria-hidden="true" style={{ position: "fixed", left: drag.x + 12, top: drag.y + 12, pointerEvents: "none", zIndex: 100 }}>
          <Avatar avatar={dragPlayer.avatar} name={dragPlayer.name} size="small" />
          <span>{dragPlayer.name}</span>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import QRCode from "qrcode";
import {
  ArrowRight,
  Check,
  Hand,
  Link,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  Shield,
  UsersRound,
  X,
  BookOpen,
  Layers,
  LogOut,
} from "lucide-react";
import type {
  GameSettings,
  RoomView,
  Seat,
  Session,
  StoredPreset,
} from "../shared/types";
import { AVATARS, CARDS, artUrl, cardById } from "../shared/cards";
import { api, uploadAvatar } from "./api";
import {
  Avatar,
  AvatarPicker,
  Brand,
  Confirm,
  CopyButton,
  ErrorNotice,
  Ornament,
  Sheet,
} from "./components";
import Effects, { playDownAlert, type Preferences } from "./Effects";
import { PreferenceControls } from "./App";
import Table from "./Table";
import Settings from "./Settings";
import SeatAssignment from "./SeatAssignment";
import HelpPanel from "./HelpPanel";
import CardTask from "./CardTask";
import DownNotice from "./DownNotice";
import FullscreenButton from "./FullscreenButton";

type PendingView = {
  code: string;
  status: "pending" | "removed";
  name: string;
  avatar: string;
  avatarMatchId: string;
};
type Action = (type: string, data?: Record<string, unknown>) => Promise<void>;
function useRoom(code: string, session: Session) {
  const [view, setView] = useState<RoomView | PendingView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<Socket | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const socket = io({
      auth: { token: session.token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    ref.current = socket;
    socket.on("room", (next) => setView(next));
    socket.on("connect", () => {
      socket
        .timeout(8000)
        .emit(
          "watch",
          code,
          (err: Error | null, result: { ok: boolean; error?: string }) => {
            if (err) {
              setError("连接房间超时，请检查网络");
              return;
            }
            if (!result.ok) {
              setError(result.error!);
              return;
            }
            setConnected(true);
            setError("");
          },
        );
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => setError(`连接失败：${e.message}`));
    socket.on("server:error", setError);
    socket.on("down-alert",event=>window.dispatchEvent(new CustomEvent("snake-down",{detail:event})));
    return () => {
      socket.disconnect();
      ref.current = null;
    };
  }, [code, session.token]);
  const action: Action = async (type, data = {}) => {
    const socket = ref.current;
    const latest = viewRef.current;
    if (!socket?.connected || !latest || !("matchId" in latest))
      throw new Error("尚未连接到牌局，请等待重连");
    setBusy(true);
    setError("");
    try {
      await new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit(
          "action",
          {
            type,
            data: { ...data, turnId: latest.turn?.id },
            requestId: crypto.randomUUID(),
            matchId: latest.matchId,
          },
          (err: Error | null, result: { ok: boolean; error?: string }) => {
            if (err) reject(new Error("操作确认超时，请查看当前局面后重试"));
            else if (!result.ok) reject(new Error(result.error));
            else resolve();
          },
        );
      });
    } finally {
      setBusy(false);
    }
  };
  return { view, connected, error, setError, busy, action };
}
export default function RoomApp({
  code,
  session,
  prefs,
  setPrefs,
  onHome,
  onCatalog,
  onSessionInvalid,
  notice = "",
}: {
  code: string;
  session: Session;
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  onHome: () => void;
  onCatalog: () => void;
  onSessionInvalid: () => void;
  notice?: string;
}) {
  const { view, connected, error, setError, busy, action } = useRoom(
    code,
    session,
  );
  const [tab, setTab] = useState("table");
  const [downNotice,setDownNotice]=useState<{from:string;status:string}|null>(null);
  const taskOpened=useRef("");
  const [taskDirty,setTaskDirty]=useState(false);
  const seenAlert=useRef("");
  const [panel, setPanel] = useState<string | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldPress = useRef(false);
  const lastHelp = useRef(0);
  const previousState = useRef<string | null>(null);
  const [ruleCard, setRuleCard] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [effect, setEffect] = useState<{
    cardId: string;
    name: string;
    avatar: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const previous = useRef<{
    turnId?: string;
    effectAt?: number;
    matchId: string;
  } | null>(null);
  useEffect(()=>{
    const receive=(event:Event)=>{
      const data=(event as CustomEvent).detail;
      if(seenAlert.current===data.id)return;
      seenAlert.current=data.id;
      setDownNotice({from:data.fromPlayerId,status:"正在处理提醒…"});
      void playDownAlert(prefs).then(status=>setDownNotice({from:data.fromPlayerId,status})).catch(e=>setDownNotice({from:data.fromPlayerId,status:`提醒震动未完成：${e.message}`}));
    };
    window.addEventListener("snake-down",receive);
    return ()=>window.removeEventListener("snake-down",receive);
  },[prefs]);
  useEffect(()=>{
    if(!view||!("turn" in view)||!view.turn?.task||effect||view.state!=="running")return;
    const key=view.turn.id+":"+view.turn.task.kind;
    if(taskOpened.current!==key){taskOpened.current=key;setPanel("task");}
  },[view,effect]);
  const [qr, setQr] = useState("");
  const [first, setFirst] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<GameSettings | null>(null);
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [insert, setInsert] = useState<{ after: Seat; before: Seat } | null>(
    null,
  );
  const [swapA, setSwapA] = useState("");
  const [swapB, setSwapB] = useState("");
  useEffect(() => () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  }, [tab, view && "turn" in view ? view.turn?.id : null, view && "state" in view ? view.state : null]);
  const run = async (type: string, data: Record<string, unknown> = {}) => {
    try {
      await action(type, data);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!view || !("turn" in view)) return;
    if (view.state === "paused" && previousState.current !== "paused") {
      setTab("table"); setPanel(p => p === "help" ? p : null); setDetail(null); setRuleCard(null); setEffect(null);
    }
    if(view.state==="ended"&&previousState.current!=="ended"){setPanel(null);setDetail(null);setRuleCard(null);setEffect(null);}
    previousState.current = view.state;
    const t = view.turn;
    const prev = previous.current;
    if(view.state==="running" && t?.cardId && t.effectAt!==undefined && prev?.matchId===view.matchId && prev.turnId===t.id && prev.effectAt!==t.effectAt){
      const def=cardById(t.cardId);
      const p=view.players.find(p=>p.id===t.playerId);
      if(p && view.serverTime-t.effectAt<def.effectMs && (def.effectScope==="all"||view.selfPlayerId===t.playerId)){taskOpened.current="";setPanel(null);setDetail(null);setRuleCard(null);setEffect({cardId:t.cardId,name:p.name,avatar:p.avatar});}
    }
    previous.current = {
      turnId: t?.id,
      effectAt: t?.effectAt,
      matchId: view.matchId,
    };
    const count = view.backupHelpNotice ? 1 : view.helpRequests.filter(h => h.resolvedAt === null).length;
    if (count > lastHelp.current && prefs.vibration && navigator.vibrate) navigator.vibrate([80, 60, 80]);
    lastHelp.current = count;
  }, [view]);
  useEffect(() => {
    if (panel !== "invite") return;
    QRCode.toDataURL(`${location.origin}/?room=${code}`, {
      width: 480,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: "#221c1e", light: "#f6f0e6" },
    })
      .then(setQr)
      .catch((e) => setError(`二维码生成失败：${e.message}`));
  }, [panel, code]);
  const openSettings = () => {
    if (!view || !("settings" in view)) return;
    setSettingsDraft(structuredClone(view.settings));
    setPanel("settings");
    if (session.actor.kind === "host")
      api<StoredPreset[]>("/api/presets", session)
        .then(setPresets)
        .catch((e) => setError(e.message));
  };
  if (!view)
    return (
      <div className="room-loading">
        <Brand />
        <div className="skeleton card-skeleton" />
        <h1>正在连接牌局</h1>
        <p>从服务器同步真实局面…</p>
        <ErrorNotice message={error} />
        {error && (
          <button className="sk-button secondary" onClick={onSessionInvalid}>
            重新登录或申请
          </button>
        )}
      </div>
    );
  if ("status" in view)
    return (
      <div className="pending-page">
        <header className="page-header">
          <Brand small />
          <FullscreenButton onError={setError} />
          <button className="nav-link" onClick={onHome}>
            返回首页
          </button>
        </header>
        <main>
          <div className="pending-art">
            <img
              src={artUrl(view.status === "removed" ? "c30" : "c07")}
              alt="蛇结等候版画"
            />
          </div>
          <span className="eyebrow">
            ROOM <span className="sk-num">{code}</span>
          </span>
          <h1>
            {view.status === "removed"
              ? "本次入场未获准"
              : "留步片刻，\n等主持人迎你入局。"}
          </h1>
          <p>
            {view.status === "removed"
              ? "申请已被拒绝或你已被移出牌局，请联系现场主持人。"
              : `${view.name}，入场申请已送达。无需选座，主持人会为你安排。`}
          </p>
          <div className="pending-status">
            <span className={`connection-dot ${connected ? "online" : ""}`} />
            {view.status === "removed"
              ? "本次身份已停用"
              : connected
                ? "等待现场批准"
                : "网络连接中断，正在重连"}
          </div>
          <ErrorNotice message={error || notice} />
          {view.status === "removed" && (
            <button className="sk-button" onClick={onSessionInvalid}>
              返回入场
            </button>
          )}
          <label className="upload-button">
            更换本局头像
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  await uploadAvatar(code, session, file, view.avatarMatchId);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
        </main>
      </div>
    );
  if(Number(view.schemaVersion)!==3)return <div className="pending-page"><Brand small/><h1>旧版房间尚未升级</h1><p>为保留当前牌局，本页不会把第三版规则套用到旧局。请先结束旧局，再启动新版服务。</p>{view.canControl&&view.state!=="ended"&&<button className="danger-button" onClick={()=>{if(window.confirm("结束这局旧版牌局？结束后无法继续本局。"))void run("end");}}>结束这局旧版牌局</button>}<ErrorNotice message={error}/><button className="tool-button" onClick={onHome}>返回首页</button></div>;
  const room = view;
  const activePlayers = room.players.filter((p) => p.approved && !p.removed);
  const applicants = room.players.filter((p) => !p.approved && !p.removed);
  const current = activePlayers.find((p) => p.id === room.turn?.playerId);
  const myTurn = room.turn?.playerId === room.selfPlayerId;
  const card = room.turn?.cardId ? cardById(room.turn.cardId) : null;
  const seats = room.pendingSeats === null ? room.seats : room.pendingSeats;
  const unseated = activePlayers.filter(
    (p) => !seats.some((s) => s.playerId === p.id),
  );
  const controller =
    room.controllerId === room.ownerId
      ? room.ownerName
      : activePlayers.find((p) => p.id === room.controllerId)?.name;
  const canDraw = room.settings.drawMode === "host" ? room.canControl : myTurn;
  const playerDetail = detail
    ? activePlayers.find((p) => p.id === detail)
    : null;
  const seatClick = (seat: Seat) => { if (seat.playerId) { setPanel(null); setDetail(seat.playerId); } };
  return (
    <div className={`room-shell ${room.state === "running" || room.state === "paused" ? "is-playing" : ""} ${room.canControl ? "is-controller" : ""}`}>
      <header className="room-header">
        <Brand small />
        <div className="room-code">
          {(room.canControl || room.isOwner || room.selfPlayerId) && <button className="help-entry" aria-label={room.canControl || room.isOwner ? "求助提醒" : "寻求帮助"} onClick={() => setPanel("help")}>
            {room.canControl || room.isOwner ? "求助提醒" : "寻求帮助"}
            {(room.helpRequests.some(h => h.resolvedAt === null) || room.ownHelpPending) && <i aria-label="有待处理求助" />}
          </button>}

          <span>房间</span>
          <strong className="sk-num">{code}</strong>
          <CopyButton value={code} />
          <button
            className="icon-button"
            onClick={() => setPanel("preferences")}
            aria-label="声音与动效设置"
          >
            <Settings2 size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("invite")}
            aria-label="邀请与二维码"
          >
            <ScanLine size={21} />
          </button>
          <FullscreenButton onError={setError} />
        </div>
      </header>
      <div className="connection-bar">
        <span>
          <i className={`connection-dot ${connected ? "online" : ""}`} />
          {connected ? "已同步" : "连接中断，正在重连"}
        </span>
        <span>
          {room.state === "lobby"
            ? "等待开局"
            : room.state === "running"
              ? "进行中"
              : room.state === "paused"
                ? "已暂停"
                : "本局结束"}{" "}
          · {activePlayers.length} 人
        </span>
      </div>
      <ErrorNotice message={error || notice} />
      <main className="room-main" id="main-content">
        <div className="room-title-row">
          <div>
            <span className="eyebrow">
              {room.state === "lobby"
                ? "BEFORE THE FIRST CARD"
                : room.state === "ended"
                  ? "UNTIL NEXT TIME"
                  : "THE NIGHT IS IN PLAY"}
            </span>
            <h1>
              {room.state === "lobby"
                ? "今夜，同桌入局。"
                : room.state === "ended"
                  ? "这一局，落幕。"
                  : `${current ? current.name : "等待玩家"}的回合`}
            </h1>
          </div>
          {(room.canControl || room.isOwner) && (
            <button className="tool-button" aria-label="主持工具" onClick={() => setPanel("host")}>
              <Shield size={17} />
              主持工具
              {applicants.length > 0 && <span>{applicants.length}</span>}
            </button>
          )}
        </div>
        {room.backupHelpNotice && <p className="backup-help-notice" role="status">有人需要帮助，请先告知原主持人。</p>}
        {room.state === "lobby" ? (
          <div className="lobby-grid">
            <section className="lobby-main">
              <div className="section-title">
                <h2>现场座次</h2>
                <span>
                  {unseated.length > 0
                    ? `${unseated.length} 人待安排`
                    : "已绑定的座次"}
                </span>
              </div>
              <Table
                room={room}
                seats={seats}
                editable={room.canControl}
                onSeat={(seat) => seat.playerId && setDetail(seat.playerId)}
                onInsert={(after, before) => setInsert({ after, before })}
              />
              {room.canControl ? <button className="sk-button secondary" onClick={() => setPanel("seats")}>拖动头像安排座次</button> : <p className="table-hint">座次由主持人安排，你无需操作。</p>}

              {room.canControl && unseated.length > 0 && (
                <div className="unseated-line">
                  <span>待安排</span>
                  {unseated.map((p) => (
                    <button className="text-button" key={p.id} onClick={() => setDetail(p.id)}>{p.name}</button>
                  ))}
                </div>
              )}
            </section>
            <aside className="lobby-aside">
              {room.canControl && (
                <>
                  <div className="section-title">
                    <h2>入场申请</h2>
                    <span>{applicants.length} 人</span>
                  </div>
                  {applicants.length === 0 ? (
                    <div className="empty-inline">
                      <UsersRound size={23} />
                      <p>等同桌的朋友扫码加入。</p>
                      <button
                        className="text-button"
                        onClick={() => setPanel("invite")}
                      >
                        显示邀请二维码
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    applicants.map((p) => (
                      <div className="applicant-row" key={p.id}>
                        <Avatar avatar={p.avatar} name={p.name} />
                        <strong>{p.name}</strong>
                        <button
                          className="icon-button"
                          aria-label={`拒绝${p.name}`}
                          onClick={() => void run("reject", { playerId: p.id })}
                          disabled={busy}
                        >
                          <X size={18} />
                        </button>
                        <button
                          className="approve-button"
                          aria-label={`批准${p.name}`}
                          onClick={() =>
                            void run("approve", { playerId: p.id })
                          }
                          disabled={busy}
                        >
                          <Check size={20} />
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
              <div className="section-title">
                <h2>开局设置</h2>
                <button
                  className="icon-button"
                  aria-label="查看卡组配置"
                  onClick={openSettings}
                >
                  <Settings2 size={19} />
                </button>
              </div>
              <dl className="room-facts">
                <div>
                  <dt>抽牌方向</dt>
                  <dd>{room.settings.direction === 1 ? "顺时针" : "逆时针"}</dd>
                </div>
                <div>
                  <dt>本局上限</dt>
                  <dd>
                    抽完整副结束
                  </dd>
                </div>
                <div>
                  <dt>启用卡牌</dt>
                  <dd>
                    {
                      Object.values(room.settings.config).filter(
                        (c) => c.count > 0,
                      ).length
                    }{" "}
                    种
                  </dd>
                </div>
                <div>
                  <dt>首位抽牌</dt>
                  <dd>{room.hostPlayerId ? room.ownerName : "主持人指定"}</dd>
                </div>
              </dl>
              {room.canControl && (
                <>
                  {!room.hostPlayerId && (
                    <label className="sk-field-label">
                      首抽玩家
                      <select
                        className="sk-field"
                        value={first}
                        onChange={(e) => setFirst(e.target.value)}
                      >
                        <option value="">请选择已入座玩家</option>
                        {activePlayers
                          .filter((p) =>
                            room.seats.some((s) => s.playerId === p.id),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <button
                    className="sk-button start-button"
                    disabled={
                      busy ||
                      !connected ||
                      unseated.length > 0 ||
                      activePlayers.length < 2 ||
                      (!room.hostPlayerId && !first)
                    }
                    onClick={() => void run("start", { playerId: first })}
                  >
                    <Play size={18} />
                    开始这一局
                  </button>
                  <p className="sk-muted">
                    {unseated.length > 0
                      ? "请先安排所有参玩者的座次。"
                      : activePlayers.length < 2
                        ? "至少 2 位参玩者才能开局。"
                        : "确认所有人已到场，再开始游戏。"}
                  </p>
                </>
              )}
            </aside>
          </div>
        ) : room.state === "ended" ? (
          <section className="end-scene">
            <Ornament />
            <span className="eyebrow">THE LAST CARD HAS FALLEN</span>
            <h2>
              相聚有时，
              <br />
              下局再续。
            </h2>
            <p>{room.endReason}</p>
            <div className="end-count">
              <strong className="sk-num">{room.drawCount}</strong>
              <span>次抽牌 · {activePlayers.length} 位朋友</span>
            </div>
            <p className="sk-muted">本局上传头像已从服务器删除。</p>
            {room.isOwner && (
              <button
                className="sk-button"
                disabled={busy}
                onClick={() => void run("again")}
              >
                <RefreshCw size={18} />
                保留座次，再来一局
              </button>
            )}
            <button
              className="sk-button secondary"
              onClick={() => setPanel("history")}
            >
              回看本局
            </button>
            <button className="sk-button secondary" onClick={onHome}>
              返回首页
            </button>
          </section>
        ) : (
          <>
            {tab === "table" ? (
              <div className={`play-grid ${myTurn ? "is-recipient" : ""}`}>
                <div className="table-utilities">
                  <button className="tool-button" onClick={() => setPanel("map")}><UsersRound size={17}/>桌图</button>
                  <span className="sk-num">{room.drawCount} 次</span>
                  <button className="tool-button" onClick={() => setPanel("remaining")}><Layers size={17}/>本局剩余</button>
                  {(room.canControl || room.isOwner) && <button className="icon-button" aria-label="主持工具" onClick={() => setPanel("host")}><Shield size={19}/>{applicants.length > 0 && <small>{applicants.length}</small>}</button>}
                </div>
                {room.state === "paused" ? <section className="pause-screen" role="status">
                  <Pause size={40}/><h2>牌局已暂停</h2><p>{room.pauseReason}</p>
                  <small>仍可查看参与者与我的卡牌</small>
                  {room.canControl && <button className="sk-button" disabled={busy || !connected} onClick={() => void run("resume")}>继续牌局</button>}
                </section> : <section className="draw-stage">
                  <div className="recipient-line">
                    {current && <Avatar avatar={current.avatar} name={current.name} king={current.id === room.kingId} sharedKing={room.identities.some(h=>h.playerId===current.id&&h.cardId==="c03"&&h.shared)} size="small"/>}
                    <strong>{myTurn ? "这一张属于你" : `${current?.name}的回合`}</strong>
                    {room.settings.drawMode === "host" && <small>主持代抽</small>}
                  </div>
                  <button className={`playing-card ${card ? "revealed" : ""}`}
                    onPointerDown={() => {
                      heldPress.current = false;
                      if (card) longPress.current = setTimeout(() => { heldPress.current = true; setRuleCard(card.id); }, 450);
                    }}
                    onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current); }}
                    onPointerCancel={() => { if (longPress.current) clearTimeout(longPress.current); }}
                    onPointerLeave={() => { if (longPress.current) clearTimeout(longPress.current); }}
                    onContextMenu={e => e.preventDefault()}
                    onClick={() => {
                      if (heldPress.current) { heldPress.current = false; return; }
                      if (card) setRuleCard(card.id); else if (canDraw) void run("draw");
                    }}
                    disabled={!connected || busy || (!card && !canDraw)}
                    aria-label={card ? `查看${card.name}规则` : canDraw ? "抽取你的牌" : "等待抽牌"}>
                    <img className="playing-card-art" src={card ? artUrl(card.id) : "/art/brand/card-back.webp"} alt={card ? `${card.name}卡面` : "蛇结卡背"}/>
                    <div className="card-ornamental-frame"/>
                    <span className="playing-card-name">{card ? card.name : "蛇结"}</span>
                  </button>
                  <small className="draw-hint">{card ? room.turn?.autoAdvance ? "展示后自动进入下一位" : "点击或长按卡牌查看规则" : canDraw ? "点击上方卡牌抽牌" : room.settings.drawMode === "host" ? "等待主持人抽牌" : "等待当前玩家抽牌"}</small>
                  {room.turn?.task && <button className="sk-button secondary small task-access" onClick={()=>setPanel("task")}>打开本牌操作</button>}
                </section>}
              </div>
            ) : tab === "players" ? (
              <section className="players-tab">
                <div className="section-title">
                  <h2>同桌玩家</h2>
                  <button
                    className="text-button"
                    onClick={() => setPanel("map")}
                  >
                    查看桌图
                  </button>
                </div>
                <div className="players-list">
                  {activePlayers.map((p) => {
                    const index = room.seats.findIndex(s => s.playerId === p.id);
                    return <div className="player-management-row" key={p.id}>
                      <button className="player-row" onClick={() => setDetail(p.id)}>
                        <span className="sk-num seat-list-number">{index >= 0 ? index + 1 : "—"}</span>
                        <Avatar avatar={p.avatar} name={p.name} king={p.id === room.kingId} sharedKing={room.identities.some(h=>h.playerId===p.id&&h.cardId==="c03"&&h.shared)}/>
                        <span><strong>{p.name}</strong><small>{p.online ? "在线" : "离线"} · {index < 0 ? "待安排" : `${room.identities.filter(h => h.playerId === p.id).length} 张持有牌`}</small></span>
                      </button>
                      {room.canControl && p.id !== room.hostPlayerId && p.id !== room.controllerId && <button className="text-button danger-button" onClick={() => setConfirm({title:`移出${p.name}？`,description:"将移出本局并释放其座位；涉及当前任务时会暂停，请确认现场后跳过回合。",run:()=>action("kick",{playerId:p.id})})}>移出</button>}
                    </div>;
                  })}
                </div>
              </section>
            ) : (
              <section className="held-tab">
                <span className="eyebrow">YOUR COLLECTION TONIGHT</span>
                <h2>我的持有牌</h2>
                <HeldCards room={room} playerId={room.selfPlayerId} action={action} />
              </section>
            )}
          </>
        )}
      </main>
      <nav className="room-bottom-nav">
        {(
          [
            ["table", "牌桌", Layers],
            ["players", "参与者", UsersRound],
            ["held", "我的卡牌", Hand],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => { if (room.state === "lobby" && id !== "table") setPanel(id === "players" ? "manage" : "my-held"); else setTab(id); }}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {room.canControl && (room.state === "running" || room.state === "paused") && <div className="host-quick-actions">
        <button disabled={busy || !connected} onClick={() => void run(room.state === "paused" ? "resume" : "pause")}>{room.state === "paused" ? <Play size={17}/> : <Pause size={17}/>} {room.state === "paused" ? "继续" : "暂停"}</button>
        <button disabled={busy || !connected} onClick={() => setConfirm({title:"取消任务／跳过回合",description:"已抽的牌不会放回，记录主持跳过原因。",run:()=>action("skip",{reason:"现场主持确认跳过"})})}>取消／跳过</button>
        {card && !room.turn?.autoAdvance && !room.turn?.task && card.completion !== "seat_swap" && <button className="confirm-task" disabled={busy || !connected || room.state !== "running"} onClick={() => void run("settle", {result:"现场任务已完成"})}><Check size={17}/>确认完成</button>}
      </div>}
      {panel === "manage" && <Sheet title="玩家管理" onClose={() => setPanel(null)}>
        <div className="players-list">{activePlayers.map(p => <div className="player-management-row" key={p.id}>
          <button className="player-row" onClick={() => {setPanel(null);setDetail(p.id);}}><Avatar avatar={p.avatar} name={p.name}/><span><strong>{p.name}</strong><small>{p.online ? "在线" : "离线"} · {room.seats.some(s => s.playerId === p.id) ? "已入座" : "待安排"}</small></span></button>
          {room.canControl && p.id !== room.hostPlayerId && p.id !== room.controllerId && <button className="text-button danger-button" onClick={() => setConfirm({title:`移出${p.name}？`,description:"对方将无法继续参与本局；涉及当前任务时会暂停，等待主持确认后跳过。",run:()=>action("kick",{playerId:p.id})})}>移出</button>}
        </div>)}</div>
      </Sheet>}
      {panel === "my-held" && <Sheet title="我的卡牌" onClose={() => setPanel(null)}><HeldCards room={room} playerId={room.selfPlayerId} action={action}/></Sheet>}
      {panel === "task" && room.state!=="ended" && room.turn?.task && <Sheet title={card?`${card.name} · 本牌操作`:"本牌操作"} onClose={()=>{if(busy)return;if(taskDirty&&!window.confirm("放弃尚未提交的输入或选择？"))return;setPanel(null);}}><CardTask key={room.turn.id+room.turn.task.kind} room={room} action={action} busy={busy} onDirtyChange={setTaskDirty}/></Sheet>}
      {downNotice && <DownNotice name={activePlayers.find(p=>p.id===downNotice.from)?.name??"本局玩家"} status={downNotice.status} onClose={()=>setDownNotice(null)}/>}
      {panel === "help" && <HelpPanel room={room} action={action} onClose={() => setPanel(null)}/>}
      {panel === "map" && <Sheet title="现场桌图" wide onClose={() => setPanel(null)}><Table room={room} onSeat={seatClick}/></Sheet>}
      {panel === "remaining" && <Sheet title="本局剩余" onClose={() => setPanel(null)}>
        <div className="remaining-list">{CARDS.filter(c => room.settings.config[c.id].count > 0).map(c => <button className="remaining-card" key={c.id} onClick={() => { setPanel(null); setDetail(null); setRuleCard(c.id); }}><img src={artUrl(c.id)} alt=""/><span>{c.name}</span><strong className="sk-num">{room.remaining[c.id]} 次</strong></button>)}</div>
        {!CARDS.some(c => room.settings.config[c.id].count > 0) && <p>本局没有设置有限次数卡牌。</p>}
      </Sheet>}
      {ruleCard && <Sheet title={cardById(ruleCard).name} onClose={() => setRuleCard(null)}><p>{cardById(ruleCard).rules}</p></Sheet>}
      {panel === "invite" && (
        <Sheet title="邀同桌的人入局" onClose={() => setPanel(null)}>
          <div className="invite-sheet">
            {qr ? (
              <img className="qr-image" src={qr} alt="加入本房间的二维码" />
            ) : (
              <div className="skeleton qr-skeleton" />
            )}
            <span className="sk-label">房间码</span>
            <div className="large-code sk-num">
              {code}
              <CopyButton value={code} />
            </div>
            <p>扫码后仍需现场主持人批准。</p>
            {["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && <p className="sk-muted">
              手机测试请使用本机局域网地址访问后再展示二维码；localhost
              只指向当前设备。
            </p>}
            <span>
              {room.accepting ? "新玩家可申请入场" : "主持人已关闭新入场"}
            </span>
          </div>
        </Sheet>
      )}
      {panel === "history" && (
        <Sheet title="本局记录" onClose={() => setPanel(null)}>
          <div className="history-list">
            {[...room.logs].reverse().map((item) => (
              <div key={item.id}>
                <time className="sk-num">
                  {new Date(item.at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <p>{item.message}</p>
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {panel === "host" && (
        <Sheet title="主持工具" onClose={() => setPanel(null)}>
          <p className="sk-muted">
            原主持：{room.ownerName} · 当前控场：{controller}
          </p>
          {room.isOwner && room.controllerId !== room.ownerId && (
            <button className="sk-button" onClick={() => void run("reclaim")}>
              <Shield size={18} />
              收回控场权限
            </button>
          )}
          {room.canControl && (
            <>
              <div className="section-title">
                <h3>入场申请</h3>
                <label className="inline-toggle">
                  开放
                  <input
                    type="checkbox"
                    checked={room.accepting}
                    disabled={room.state === "ended" || busy}
                    onChange={(e) =>
                      void run("set-accepting", { accepting: e.target.checked })
                    }
                  />
                </label>
              </div>
              {applicants.map((p) => (
                <div className="applicant-row" key={p.id}>
                  <Avatar avatar={p.avatar} name={p.name} />
                  <strong>{p.name}</strong>
                  <button
                    className="icon-button"
                    aria-label={`拒绝${p.name}`}
                    onClick={() => void run("reject", { playerId: p.id })}
                  >
                    <X size={18} />
                  </button>
                  <button
                    className="approve-button"
                    aria-label={`批准${p.name}`}
                    onClick={() => void run("approve", { playerId: p.id })}
                  >
                    <Check size={19} />
                  </button>
                </div>
              ))}
              <label className="sk-field-label">抽牌方式 · 下一回合生效
                <select className="sk-field" value={room.pendingDrawMode === null ? room.settings.drawMode : room.pendingDrawMode} disabled={busy || room.state === "ended"} onChange={e => void run("draw-mode",{mode:e.target.value})}>
                  <option value="player">轮到的玩家点击抽牌</option><option value="host">当前控场者代抽</option>
                </select>
              </label>
              {room.pendingDrawMode && <p className="sk-muted">抽牌方式将在下回合更新。</p>}
              <div className="tool-grid">
                <button onClick={() => setPanel("manage")}><UsersRound/>玩家管理</button>
                <button onClick={() => setPanel("seats")}>
                  <UsersRound />
                  座位设置
                  {unseated.length > 0 && (
                    <small>{unseated.length} 人待安排</small>
                  )}
                </button>
                <button onClick={openSettings}>
                  <Settings2 />
                  卡组与模板
                </button>
                <button onClick={() => setPanel("invite")}>
                  <ScanLine />
                  入场二维码
                </button>
                <button onClick={() => setPanel("history")}>
                  <BookOpen />
                  本局记录
                </button>
              </div>
              {room.state !== "lobby" && room.state !== "ended" && (
                <>
                  <button
                    className="sk-button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(room.state === "paused" ? "resume" : "pause")
                    }
                  >
                    {room.state === "paused" ? "继续牌局" : "暂停牌局"}
                  </button>
                  <button
                    className="sk-button secondary"
                    onClick={() =>
                      setConfirm({
                        title: "跳过当前回合",
                        description: "会记录跳过原因，已抽的牌不重新放回。",
                        run: () =>
                          action("skip", { reason: "现场主持确认跳过" }),
                      })
                    }
                  >
                    取消任务／跳过当前玩家
                  </button>
                </>
              )}
              <button
                className="danger-button"
                disabled={room.state === "ended"}
                onClick={() =>
                  setConfirm({
                    title: "终止这一局？",
                    description: "本局将结束并删除上传头像，保留记录 24 小时。",
                    run: () => action("end"),
                  })
                }
              >
                终止本局
              </button>
            </>
          )}
          {room.isOwner && room.state !== "ended" && (
            <div className="authority-settings">
              <h3>控场权限</h3>
              <label className="sk-field-label">
                转交控场
                <select
                  className="sk-field"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id)
                      setConfirm({
                        title: "转交控场权限",
                        description:
                          "对方将能批准入场、安排座次和结算任务。你仍可随时收回。",
                        run: () => action("transfer", { playerId: id }),
                      });
                  }}
                >
                  <option value="">选择在线玩家</option>
                  {activePlayers
                    .filter((p) => p.online && p.id !== room.hostPlayerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="sk-field-label">
                断线备用控场者
                <select
                  className="sk-field"
                  value={room.backupId === null ? "" : room.backupId}
                  onChange={(e) =>
                    void run("backup", {
                      playerId: e.target.value === "" ? null : e.target.value,
                    })
                  }
                >
                  <option value="">不指定</option>
                  {activePlayers
                    .filter((p) => p.id !== room.hostPlayerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="sk-muted">
                当前控场者断线时先暂停，再授权在线备用；接管者确认现场后继续。
              </p>
            </div>
          )}
          <div className="tool-grid">
            <button onClick={() => setPanel("preferences")}>
              <Settings2 />
              声音与动效
            </button>
            <button onClick={onCatalog}>
              <BookOpen />
              卡牌图鉴
            </button>
            <button onClick={() => setPanel("avatar")}>
              <UsersRound />
              我的头像
            </button>
            <button onClick={onHome}>
              <LogOut />
              返回首页
            </button>
          </div>
          <ErrorNotice message={error} />
        </Sheet>
      )}
      {panel === "seats" && (
        <Sheet title="按现场相邻关系安排" wide onClose={() => setPanel(null)}>
          {room.state === "lobby" && <SeatAssignment room={room} busy={busy || !connected} onAssign={(playerId,afterId,beforeId) => action("seat-place", {playerId,afterId,beforeId})}/>}
          <Table
            room={room}
            seats={seats}
            editable={room.canControl}
            onInsert={(after, before) => setInsert({ after, before })}
            onSeat={(s) => {
              if (s.kind !== "host" && !s.playerId)
                setConfirm({
                  title: "删除这个位置？",
                  description:
                    "只删除空位或不参与位置；进行中的牌局在回合结束后更新。",
                  run: () => action("seat-remove", { seatId: s.id }),
                });
            }}
          />
          {room.pendingSeats && (
            <p className="sk-muted">
              有待生效座次，将在当前回合结束后应用。
              <button
                className="text-button"
                onClick={() => void run("discard-seat-draft")}
              >
                撤销座次草稿
              </button>
            </p>
          )}
          <label className="sk-field-label">
            抽牌方向 · 本回合结算后生效
            <select
              className="sk-field"
              value={
                room.pendingDirection === null
                  ? room.settings.direction
                  : room.pendingDirection
              }
              onChange={(e) =>
                void run("direction", { direction: Number(e.target.value) })
              }
            >
              <option value="1">顺时针</option>
              <option value="-1">逆时针</option>
            </select>
          </label>
          {room.pendingDirection !== null && (
            <p className="sk-muted">方向变更待本回合结算后生效。</p>
          )}
          <div className="section-title">
            <h3>确认现场换座</h3>
          </div>
          <div className="field-pair">
            <select
              className="sk-field"
              aria-label="换座第一人"
              value={swapA}
              onChange={(e) => setSwapA(e.target.value)}
            >
              <option value="">第一个位置</option>
              {seats.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1} 号 ·{" "}
                  {s.playerId
                    ? activePlayers.find((p) => p.id === s.playerId)?.name
                    : s.kind === "host"
                      ? "主持人"
                      : s.kind === "empty"
                        ? "空位"
                        : "不参与"}
                </option>
              ))}
            </select>
            <select
              className="sk-field"
              aria-label="换座第二人"
              value={swapB}
              onChange={(e) => setSwapB(e.target.value)}
            >
              <option value="">第二个位置</option>
              {seats.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1} 号 ·{" "}
                  {s.playerId
                    ? activePlayers.find((p) => p.id === s.playerId)?.name
                    : s.kind === "host"
                      ? "主持人"
                      : s.kind === "empty"
                        ? "空位"
                        : "不参与"}
                </option>
              ))}
            </select>
          </div>
          <button
            className="sk-button secondary"
            disabled={!swapA || !swapB || swapA === swapB || busy}
            onClick={() =>
              setConfirm({
                title: "确认现场已完成换座",
                description: "确认后更新对应位置；牌跟人走，当前任务不变。",
                run: () => action("seat-swap", { seatA: swapA, seatB: swapB }),
              })
            }
          >
            现场已换好，更新位置
          </button>
          <ErrorNotice message={error} />
        </Sheet>
      )}
      {insert && (
        <Sheet title="在相邻位置间添加" onClose={() => setInsert(null)}>
          <p className="sk-muted">
            将插入到所选两位置之间，不需要移动其他人的身份。
          </p>
          <div className="insert-options">
            {unseated.map((p) => (
              <button
                className="player-row"
                aria-label={p.name}
                key={p.id}
                onClick={async () => {
                  try {
                    await action("seat-insert", {
                      afterId: insert.after.id,
                      beforeId: insert.before.id,
                      kind: "player",
                      playerId: p.id,
                    });
                    setInsert(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Avatar avatar={p.avatar} name={p.name} />
                <span>{p.name}</span>
                <Plus size={18} />
              </button>
            ))}
            {unseated.length === 0 && <p>所有当前参玩者都已安排位置。</p>}
            <button
              className="sk-button secondary"
              onClick={async () => {
                try {
                  await action("seat-insert", {
                    afterId: insert.after.id,
                    beforeId: insert.before.id,
                    kind: "empty",
                  });
                  setInsert(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              插入一个空位
            </button>
            <button
              className="sk-button secondary"
              onClick={async () => {
                try {
                  await action("seat-insert", {
                    afterId: insert.after.id,
                    beforeId: insert.before.id,
                    kind: "spectator",
                  });
                  setInsert(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              插入一个不参与位置
            </button>
          </div>
          <ErrorNotice message={error} />
        </Sheet>
      )}
      {panel === "settings" && settingsDraft && (
        <Sheet
          title={
            room.state === "lobby"
              ? "开局卡组与模板"
              : "本局卡组 · 开始后不可修改"
          }
          wide
          onClose={() => setPanel(null)}
        >
          {room.isOwner && room.state === "lobby" && (
            <>
              <label className="sk-field-label">
                读取服务器模板
                <select
                  className="sk-field"
                  value=""
                  onChange={(e) => {
                    const p = presets.find((p) => p.id === e.target.value);
                    if (p) setSettingsDraft(structuredClone(p.settings));
                  }}
                >
                  <option value="">选择配置</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-pair template-save">
                <input
                  className="sk-field"
                  placeholder="新模板名称"
                  aria-label="新模板名称"
                  value={presetName}
                  maxLength={32}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button
                  className="sk-button secondary"
                  disabled={!presetName.trim()}
                  onClick={async () => {
                    try {
                      await api("/api/presets", session, {
                        name: presetName,
                        settings: settingsDraft,
                      });
                      setPresets(
                        await api<StoredPreset[]>("/api/presets", session),
                      );
                      setPresetName("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  保存为新模板
                </button>
              </div>
              {presets.length > 0 && (
                <details className="template-manager">
                  <summary>管理已保存模板（{presets.length}）</summary>
                  {presets.map((p) => (
                    <div className="template-row" key={p.id}>
                      <span>{p.name}</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setConfirm({
                            title: "删除配置模板",
                            description: `删除「${p.name}」不会影响已开始的牌局。`,
                            run: async () => {
                              await api(
                                `/api/presets/${p.id}`,
                                session,
                                undefined,
                                "DELETE",
                              );
                              setPresets(
                                await api<StoredPreset[]>(
                                  "/api/presets",
                                  session,
                                ),
                              );
                            },
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
          <Settings
            value={settingsDraft}
            onChange={setSettingsDraft}
            disabled={room.state !== "lobby" || !room.canControl}
          />
          {room.canControl && room.state === "lobby" && (
            <button
              className="sk-button"
              disabled={busy}
              onClick={async () => {
                try {
                  await action("settings", { settings: settingsDraft });
                  setPanel(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              应用开局配置
            </button>
          )}
          <ErrorNotice message={error} />
        </Sheet>
      )}
      {panel === "preferences" && (
        <Sheet title="声音与动效" onClose={() => setPanel(null)}>
          <PreferenceControls prefs={prefs} setPrefs={setPrefs} />
          <button
            className="sk-button secondary"
            onClick={() => setPanel("avatar")}
          >
            更换我的头像
          </button>
        </Sheet>
      )}
      {panel === "avatar" && (
        <Sheet title="我的本局头像" onClose={() => setPanel(null)}>
          <p>上传头像会在本局结束时删除。预设头像可在下一次入场时选择。</p>
          {room.selfPlayerId ? (
            <label className="upload-button">
              选择图片上传
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await uploadAvatar(code, session, file, room.matchId);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            </label>
          ) : (
            <p>仅控场的主持人没有参玩头像。</p>
          )}
          <ErrorNotice message={error} />
        </Sheet>
      )}
      {playerDetail && (
        <Sheet title={playerDetail.name} onClose={() => setDetail(null)}>
          <div className="player-detail-header">
            <Avatar
              avatar={playerDetail.avatar}
              name={playerDetail.name}
              size="large"
              king={room.kingId === playerDetail.id} sharedKing={room.identities.some(h=>h.playerId===playerDetail.id&&h.cardId==="c03"&&h.shared)}
            />
            <div>
              <h3>{playerDetail.name}</h3>
              <p>
                {playerDetail.online ? "在线" : "离线"} ·{" "}
                {room.seats.findIndex((s) => s.playerId === playerDetail.id) +
                  1}{" "}
                号位
              </p>
            </div>
          </div>
          <HeldCards room={room} playerId={playerDetail.id} />
          {room.canControl &&
            playerDetail.id !== room.hostPlayerId &&
            playerDetail.id !== room.controllerId &&
            room.state !== "ended" && (
              <button
                className="danger-button"
                onClick={() =>
                  setConfirm({
                    title: `移出${playerDetail.name}？`,
                    description: "对方的原入场身份将停用。",
                    run: async () => {
                      await action("kick", { playerId: playerDetail.id });
                      setDetail(null);
                    },
                  })
                }
              >
                移出牌局
              </button>
            )}
        </Sheet>
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          description={confirm.description}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
      {effect && room.state !== "paused" && (
        <Effects
          card={cardById(effect.cardId)}
          name={effect.name}
          avatar={effect.avatar}
          prefs={prefs}
          onClose={() => setEffect(null)}
        />
      )}
    </div>
  );
}
function HeldCards({room,playerId,action}:{room:RoomView;playerId:string|null;action?:Action}) {
 const [detail,setDetail]=useState<string|null>(null);
 const [target,setTarget]=useState("");
 const [error,setError]=useState("");const [sending,setSending]=useState(false);
 const cards=room.identities.filter(h=>h.playerId===playerId);
 const selected=cards.find(h=>h.heldId===detail);
 const own=playerId!==null&&playerId===room.selfPlayerId;
 const run=async(type:string,data:Record<string,unknown>)=>{if(!action)return;setSending(true);setError("");try{await action(type,data);}catch(e){setError((e as Error).message);}finally{setSending(false);}};
 return <div className="held-grid">
  {room.canControl&&action&&room.cardUses.map(use=><div className="held-detail" key={use.id}><strong>{room.players.find(p=>p.id===use.playerId)?.name}申请老板代劳</strong><button className="sk-button" disabled={sending||room.state!=="running"} onClick={()=>void run("item-resolve",{useId:use.id,completed:true})}>老板已同意并完成，核销一张</button><button className="tool-button" disabled={sending||room.state!=="running"} onClick={()=>void run("item-resolve",{useId:use.id,completed:false})}>拒绝／未完成，保留道具</button></div>)}
  {!cards.length&&<div className="empty-inline"><Layers size={30}/><p>暂时没有持续持有或共享的牌。</p></div>}
  {cards.map(h=>{const c=cardById(h.cardId);return <button className="held-card" key={h.heldId} onClick={()=>{setDetail(h.heldId);setTarget("");}} aria-label={`查看${c.name}规则`}><img src={artUrl(c.id)} alt={`${c.name}卡面`}/><strong>{c.name}</strong>{h.shared&&<small>共享自{room.players.find(p=>p.id===h.sourcePlayerId)?.name}</small>}</button>;})}
  {selected&&<div className="held-detail"><strong>{cardById(selected.cardId).name}</strong><p>{cardById(selected.cardId).rules}</p>
    {selected.cardId==="c08"&&room.nicknames[selected.sourcePlayerId]&&<p>小姐昵称：{room.nicknames[selected.sourcePlayerId]}</p>}
    {own&&action&&selected.cardId==="c10"&&<button className="sk-button" disabled={sending||room.state!=="running"||room.cardUses.some(u=>u.heldId===selected.heldId)} onClick={()=>void run("item-use",{heldId:selected.heldId})}>申请老板代劳，等待主持确认</button>}
    {own&&action&&selected.cardId==="c30"&&<><label className="sk-field-label">选择被点名的玩家<select className="sk-field" value={target} onChange={e=>setTarget(e.target.value)}><option value="">请选择其他玩家</option>{room.players.filter(p=>p.approved&&!p.removed&&p.id!==playerId).map(p=><option key={p.id} value={p.id}>{p.name}{p.online?"":"（离线）"}</option>)}</select></label><p className="sk-muted">同一目标冷却60秒；文字提醒始终显示，振动遵循对方设置。</p><button className="sk-button" disabled={sending||room.state!=="running"||!target} onClick={()=>void run("down",{playerId:target})}>下头！</button></>}
    <button className="tool-button" onClick={()=>setDetail(null)}>收起详情</button><ErrorNotice message={error}/>
  </div>}
 </div>;
}

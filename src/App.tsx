import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ScanLine,
  BookOpen,
  SlidersHorizontal,
  ArrowRight,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import type { GameSettings, Session, StoredPreset } from "../shared/types";
import { AVATARS, artUrl } from "../shared/cards";
import { api, uploadAvatar } from "./api";
import {
  AvatarPicker,
  Back,
  Brand,
  ErrorNotice,
  Ornament,
  Sheet,
} from "./components";
import Catalog from "./Catalog";
import FullscreenButton from "./FullscreenButton";
import { PolicyLinks } from "./Legal";
import HomePage from "./HomePage";
const Scanner = lazy(() => import("./Scanner"));
import RoomApp from "./Room";
import Settings from "./Settings";
import { unlockAudio, type Preferences } from "./Effects";

function loadSaved<T>(key: string): { value: T | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return { value: null, error: "" };
    return { value: JSON.parse(raw), error: "" };
  } catch (error) {
    return { value: null, error: error instanceof DOMException ? "浏览器不允许读取本站存储，请允许后重新进入。" : "保存的本地身份已损坏，请重新登录或加入。" };
  }
}
const initial = loadSaved<Session>("snake-session");
const initialPrefs: Preferences = {
  sound: false,
  vibration: false,
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
export default function App() {
  const params = new URLSearchParams(location.search);
  const initialCode = params.get("room");
  const [session, setSessionState] = useState<Session | null>(initial.value);
  const [code, setCode] = useState(
    initial.value?.roomCode === undefined ? "" : initial.value.roomCode,
  );
  const [page, setPage] = useState(
    initialCode ? "join" : initial.value?.roomCode ? "room" : "home",
  );
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(initialPrefs);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [joinCode, setJoinCode] = useState(
    initialCode === null ? "" : initialCode,
  );
  const [participate, setParticipate] = useState(true);
  const setSession = (next: Session | null) => {
    setSessionState(next);
    if (next) sessionStorage.setItem("snake-session", JSON.stringify(next));
    else sessionStorage.removeItem("snake-session");
  };
  useEffect(() => {
    api<GameSettings>("/api/default-settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  const task = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onScanned = useCallback((value: string) => {
    setJoinCode(value);
    setScanner(false);
    setPage("join");
  }, []);
  const home = () => {
    setPage("home");
    setError("");
    history.replaceState(null, "", "/");
  };
  const openHost = () => {
    setError("");
    if (session?.actor.kind === "host") {
      setPage("create");
      void task(async () => {
        const data = await api<{ code: string | null }>(
          "/api/host/room",
          session,
        );
        if (data.code) {
          setCode(data.code);
          setSession({ ...session, roomCode: data.code });
          setPage("room");
        } else setPresets(await api<StoredPreset[]>("/api/presets", session));
      });
    } else setPage("login");
  };
  if (page === "catalog")
    return (
      <>
        <Catalog
          onBack={() => setPage(code && session ? "room" : "home")}
          prefs={prefs}
        />
      </>
    );
  if (page === "room" && session && code)
    return (
      <RoomApp
        code={code}
        session={session}
        prefs={prefs}
        setPrefs={setPrefs}
        notice={error}
        onHome={home}
        onCatalog={() => setPage("catalog")}
        onSessionInvalid={() => {
          setSession(null);
          setCode("");
          setPage("home");
          setError("身份不可用，请重新登录或申请入场。");
        }}
      />
    );
  return (
    <div className={`app-shell ${page === "home" ? "home-mode" : ""}`}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="page-header">
        <Brand />
        <nav>
          <button className="nav-link" onClick={() => setPage("catalog")}>
            <BookOpen size={17} />
            <span>卡牌图鉴</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setPreferencesOpen(true)}
            aria-label="声音与动效设置"
          >
            <SlidersHorizontal size={20} />
          </button>
          <FullscreenButton onError={setError} />
        </nav>
      </header>
      <main id="main-content">
        {page === "home" ? (
          <HomePage reduced={prefs.reduced} onJoin={() => {setPage("join"); setError("");}} onHost={openHost} onCatalog={() => setPage("catalog")} onReturn={session && code ? () => setPage("room") : undefined}/>
        ) : (
          <div className="entry-grid">
            <div className="entry-art">
              <img
                src={artUrl(
                  page === "login" || page === "create" ? "c15" : "c07",
                )}
                alt="蛇结版画装饰"
              />
              <div>
                <span className="eyebrow">A SEAT AT THE TABLE</span>
                <h2>
                  {page === "join"
                    ? "留一个位置，\n等你入局。"
                    : "今夜的节奏，\n由你掌握。"}
                </h2>
                <Ornament />
              </div>
            </div>
            <div className="entry-panel">
              <Back onClick={home} />
              <span className="eyebrow">
                {page === "join"
                  ? "JOIN THE NIGHT"
                  : page === "login"
                    ? "HOST ACCESS"
                    : "SET THE NIGHT"}
              </span>
              <h1>
                {page === "join"
                  ? "加入牌局"
                  : page === "login"
                    ? "主持人登录"
                    : "开启今夜"}
              </h1>
              <p className="sk-muted">
                {page === "join"
                  ? "填好昵称，等待现场主持人批准。"
                  : page === "login"
                    ? "使用酒吧预先配置的主持账号。"
                    : "选择是否参玩，再邀请同桌的朋友。"}
              </p>
              {page === "login" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(async () => {
                      const next = await api<Session>("/api/login", null, {
                        login,
                        password,
                      });
                      setSession(next);
                      const active = await api<{ code: string | null }>(
                        "/api/host/room",
                        next,
                      );
                      if (active.code) {
                        setCode(active.code);
                        setSession({ ...next, roomCode: active.code });
                        setPage("room");
                      } else {
                        setPresets(
                          await api<StoredPreset[]>("/api/presets", next),
                        );
                        setName(login);
                        setPage("create");
                      }
                    });
                  }}
                >
                  <label className="sk-field-label">
                    登录名
                    <input
                      className="sk-field"
                      autoComplete="username"
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      required
                      maxLength={40}
                    />
                  </label>
                  <label className="sk-field-label">
                    密码
                    <input
                      className="sk-field"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      maxLength={200}
                    />
                  </label>
                  <ErrorNotice message={error} />
                  <button className="sk-button" disabled={busy}>
                    {busy ? "正在登录…" : "登录"}
                    <ArrowRight size={18} />
                  </button>
                  <p className="entry-footnote">
                    <ShieldCheck size={15} />
                    主持账号不开放公众注册
                  </p>
                </form>
              )}
              {page === "join" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(async () => {
                      const next = await api<Session>("/api/join", null, {
                        code: joinCode,
                        name,
                        avatar,
                      });
                      setSession(next);
                      setCode(joinCode);
                      setPage("room");
                      history.replaceState(null, "", "/");
                      if (avatarFile) {
                        try {
                          if (!next.avatarMatchId)
                            throw new Error(
                              "缺少本局头像标识，请进入牌局后重新上传",
                            );
                          await uploadAvatar(
                            joinCode,
                            next,
                            avatarFile,
                            next.avatarMatchId,
                          );
                        } catch (uploadError) {
                          setError(
                            `已提交入场申请，但头像上传失败：${(uploadError as Error).message}`,
                          );
                          throw uploadError;
                        }
                      }
                    });
                  }}
                >
                  <label className="sk-field-label">
                    房间码
                    <div className="input-with-button">
                      <input
                        className="sk-field sk-num"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="[0-9]{6}"
                        placeholder="输入 6 位房间码"
                        value={joinCode}
                        onChange={(e) =>
                          setJoinCode(
                            e.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        required
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setScanner(true)}
                        aria-label="打开摄像头扫码"
                      >
                        <ScanLine size={23} />
                      </button>
                    </div>
                  </label>
                  <label className="sk-field-label">
                    你的昵称
                    <input
                      className="sk-field"
                      autoComplete="nickname"
                      placeholder="同桌的朋友怎么称呼你？"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      required
                    />
                  </label>
                  <AvatarPicker
                    value={avatar}
                    onChange={setAvatar}
                    onFile={setAvatarFile}
                  />
                  {avatarFile && (
                    <p className="sk-muted selected-upload-name">待上传：{avatarFile.name}</p>
                  )}
                  <ErrorNotice message={error} />
                  <button className="sk-button" disabled={busy}>
                    {busy ? "正在申请…" : "申请入场"}
                    <ArrowRight size={18} />
                  </button>
                  <p className="entry-footnote">
                    上传图片不超过 3 MB，本局结束即从服务器删除。
                  </p>
                </form>
              )}
              {page === "create" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(async () => {
                      if (!session || !settings)
                        throw new Error("主持身份或配置尚未加载");
                      const result = await api<{ code: string }>(
                        "/api/rooms",
                        session,
                        { name, participate, settings, avatar },
                      );
                      const next = { ...session, roomCode: result.code };
                      setSession(next);
                      setCode(result.code);
                      setPage("room");
                    });
                  }}
                >
                  <label className="sk-field-label">
                    今夜的主持昵称
                    <input
                      className="sk-field"
                      value={name}
                      maxLength={24}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </label>
                  <div className="host-mode">
                    <button
                      type="button"
                      className={participate ? "selected" : ""}
                      onClick={() => setParticipate(true)}
                    >
                      <strong>参与游戏</strong>
                      <small>你先抽牌，同时掌控节奏</small>
                    </button>
                    <button
                      type="button"
                      className={!participate ? "selected" : ""}
                      onClick={() => setParticipate(false)}
                    >
                      <strong>仅控场</strong>
                      <small>由你指定首位抽牌玩家</small>
                    </button>
                  </div>
                  {participate && (
                    <AvatarPicker value={avatar} onChange={setAvatar} />
                  )}
                  <label className="sk-field-label">
                    使用配置模板
                    <select
                      className="sk-field"
                      defaultValue=""
                      onChange={(e) => {
                        const p = presets.find((p) => p.id === e.target.value);
                        if (p) setSettings(structuredClone(p.settings));
                      }}
                    >
                      <option value="">默认实体卡组</option>
                      {presets.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="settings-summary"
                    type="button"
                    onClick={() => setConfigOpen(true)}
                    disabled={!settings}
                  >
                    <SlidersHorizontal size={20} />
                    <span>
                      {settings ? settings.name : "正在加载配置"}
                      <small>方向、桌形、次数与卡组</small>
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                  <ErrorNotice message={error} />
                  <button className="sk-button" disabled={busy || !settings}>
                    {busy ? "正在创建…" : "创建房间"}
                    <ArrowRight size={18} />
                  </button>
                  <button
                    type="button"
                    className="nav-link"
                    onClick={() => {
                      setSession(null);
                      setPage("login");
                    }}
                  >
                    <LogOut size={16} />
                    切换主持账号
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
        {page === "home" && <ErrorNotice message={error} />}
      </main>
      {page !== "home" && <footer className="site-footer">
        <span>蛇结酒吧 · 现场多人卡牌</span>
        <span>聚在一桌，玩得尽兴。</span>
      </footer>}
      {scanner && (
        <Suspense
          fallback={
            <p className="sk-muted" role="status">
              正在加载扫码器…
            </p>
          }
        >
          <Scanner onCode={onScanned} onClose={() => setScanner(false)} />
        </Suspense>
      )}
      {configOpen && settings && (
        <Sheet title="开局配置" wide onClose={() => setConfigOpen(false)}>
          <Settings value={settings} onChange={setSettings} />
          <button className="sk-button" onClick={() => setConfigOpen(false)}>
            使用此配置
          </button>
        </Sheet>
      )}
      {preferencesOpen && (
        <Sheet title="声音与动效" onClose={() => setPreferencesOpen(false)}>
          <PreferenceControls prefs={prefs} setPrefs={setPrefs} />
        </Sheet>
      )}
    </div>
  );
}
export function PreferenceControls({
  prefs,
  setPrefs,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
}) {
  const [error, setError] = useState("");
  return (
    <div className="preference-controls">
      {(
        [
          ["sound", "揭牌音效", "点击后启用音效，可随时关闭"],
          ["vibration", "震动反馈", "仅在浏览器支持时触发"],
          ["reduced", "减少动态效果", "以静态事件提示代替大幅动画"],
        ] as const
      ).map(([key, label, desc]) => (
        <label key={key}>
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs[key]}
            onChange={async (e) => {
              const checked = e.target.checked;
              try {
                if (key === "sound" && checked) await unlockAudio();
                setPrefs({ ...prefs, [key]: checked });
                setError("");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </label>
      ))}
      <ErrorNotice message={error} />
      <PolicyLinks />
    </div>
  );
}

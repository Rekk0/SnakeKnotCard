import { useEffect, useState } from "react";
import { LoaderCircle, Maximize, Minimize } from "lucide-react";

export default function FullscreenButton({ onError }: { onError: (message: string) => void }) {
  const [active, setActive] = useState(!!document.fullscreenElement);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const changed = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggle = async () => {
    onError("");
    if (!document.fullscreenElement && (!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== "function")) {
      onError("此浏览器不支持网页全屏，当前仍为普通显示。");
      return;
    }
    setBusy(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch (error) {
      onError(`无法切换全屏，请检查浏览器全屏权限后重试：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setActive(!!document.fullscreenElement);
    }
  };
  const label = active ? "退出全屏" : "全屏显示";
  return (
    <button type="button" className="icon-button fullscreen-button" onClick={() => void toggle()}
      aria-label={label} title={label} aria-pressed={active} aria-busy={busy} disabled={busy}>
      {busy ? <LoaderCircle size={19} className="fullscreen-progress" aria-hidden="true" />
        : active ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}
    </button>
  );
}

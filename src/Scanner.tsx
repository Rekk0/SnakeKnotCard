import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ErrorNotice, Sheet } from "./components";
export default function Scanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const ref = useRef<Html5Qrcode | null>(null);
  const id = useRef(`scanner-${crypto.randomUUID()}`);
  useEffect(() => {
    let disposed = false;
    let started = false;
    const reader = new Html5Qrcode(id.current);
    ref.current = reader;
    if (!window.isSecureContext) {
      setError(
        "摄像头扫码需要 HTTPS 或 localhost。请使用外部扫码器，或输入房间码。",
      );
      return;
    }
    reader
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (value) => {
          if (disposed) return;
          let code: string | null = null;
          if (/^\d{6}$/.test(value)) code = value;
          else {
            try {
              const url = new URL(value);
              if (url.origin !== location.origin) {
                setError("这不是当前站点的入场二维码");
                return;
              }
              code = url.searchParams.get("room");
            } catch {
              setError("二维码不是有效的入场链接");
              return;
            }
          }
          if (!code || !/^\d{6}$/.test(code)) {
            setError("二维码中没有有效房间码");
            return;
          }
          disposed = true;
          onCode(code);
        },
        () => {
          /* Individual frames without a QR are not camera failures. */
        },
      )
      .then(async () => {
        started = true;
        if (disposed) await reader.stop();
      })
      .catch((e) => {
        if (!disposed)
          setError(`摄像头启动失败：${String(e)}。请检查权限，或输入房间码。`);
      });
    return () => {
      disposed = true;
      if (started)
        void reader.stop().catch((e) => console.error("关闭摄像头失败", e));
    };
  }, [onCode]);
  return (
    <Sheet title="扫描房间二维码" onClose={onClose}>
      <div id={id.current} className="scanner" />
      <ErrorNotice message={error} />
      <p className="sk-muted">请将主持人的入场二维码放入取景框。</p>
    </Sheet>
  );
}

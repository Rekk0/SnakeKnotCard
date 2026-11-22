import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, Check, Copy, Upload, ChevronLeft, Crown } from "lucide-react";
import { artUrl, AVATARS } from "../shared/cards";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <a
      className={`brand ${small ? "brand-small" : ""}`}
      href="/"
      aria-label="蛇结首页"
    >
      <img src="/art/brand/logo.webp" alt="" />
      <span>
        蛇结<small>SNAKE KNOT</small>
      </span>
    </a>
  );
}
export function Back({
  onClick,
  children = "返回",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className="sk-back" onClick={onClick}>
      <ChevronLeft size={18} />
      {children}
    </button>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="sk-error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Sheet({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`sk-sheet ${wide ? "sk-sheet-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={22} />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <p>{description}</p>
      <ErrorNotice message={error} />
      <div className="button-row">
        <button
          className="sk-button secondary"
          onClick={onClose}
          disabled={busy}
        >
          取消
        </button>
        <button
          className="sk-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "处理中…" : "确认"}
        </button>
      </div>
    </Sheet>
  );
}
export function Avatar({
  avatar,
  name,
  king = false,
  sharedKing = false,
  size = "normal",
}: {
  avatar: string;
  name: string;
  king?: boolean;
  sharedKing?: boolean;
  size?: "small" | "normal" | "large";
}) {
  const src = avatar.startsWith("/uploads/") ? avatar : artUrl(avatar);
  return (
    <span className={`avatar avatar-${size}`}>
      <img src={src} alt={`${name}的头像`} loading="lazy" />
      {(king||sharedKing) && <Crown className={`avatar-crown ${sharedKing&&!king?"shared":""}`} aria-label={king?"国王":"共享国王身份"} />}
    </span>
  );
}
export function AvatarPicker({
  value,
  onChange,
  onFile,
}: {
  value: string;
  onChange: (id: string) => void;
  onFile?: (file: File) => void;
}) {
  const [error, setError] = useState("");
  return (
    <div>
      <span className="sk-label">选一个今夜的身份</span>
      <div className="avatar-picker">
        {AVATARS.map((id) => (
          <button
            type="button"
            key={id}
            className={`avatar-option ${value === id ? "selected" : ""}`}
            onClick={() => onChange(id)}
            aria-label={`选择头像 ${id}`}
            aria-pressed={value === id}
          >
            <Avatar avatar={id} name={id} />
            {value === id && <Check size={15} />}
          </button>
        ))}
      </div>
      {onFile && (
        <label className="upload-button">
          <Upload size={17} />
          上传头像 · 本局结束即删除
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 3 * 1024 * 1024) {
                setError("图片不能超过 3 MB");
                return;
              }
              setError("");
              onFile(file);
            }}
          />
        </label>
      )}
      <ErrorNotice message={error} />
    </div>
  );
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        className="icon-button"
        aria-label={copied ? "已复制" : "复制房间码"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setError("复制失败，请长按房间码复制");
          }
        }}
      >
        {copied ? <Check size={18} /> : <Copy size={18} />}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "已复制" : error}
      </span>
      {error && <small className="sk-error">{error}</small>}
    </>
  );
}
export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`ornament ${className}`}
      viewBox="0 0 400 80"
      aria-hidden="true"
    >
      <path d="M10 57C80 5 104 79 175 39S294 7 389 54M25 50l-2-18 15 10m32-7 9-17 3 17m44 8 10 18 4-17m31-1 4-22 10 13m50-5 12-20 2 19m40-3 10 18 4-15m35 3 2-18 10 22" />
      <path d="M179 39c-7-22 27-36 37-15s-12 35-27 20 2-26 15-20 1 25-8 14m-20 4-21-8m62 3 24-4" />
    </svg>
  );
}

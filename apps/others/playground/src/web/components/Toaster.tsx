import { CheckCircle2, Info, XCircle } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

type Tone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  push: (tone: Tone, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

let nextId = 1;

export const ToasterProvider = (props: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Tone, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const api: ToastApi = {
    push,
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {props.children}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-1.5">
        {toasts.map((t) => {
          const Icon =
            t.tone === "success"
              ? CheckCircle2
              : t.tone === "error"
                ? XCircle
                : Info;
          return (
            <div
              key={t.id}
              className={[
                "pointer-events-auto flex min-w-[220px] max-w-[360px] items-start gap-2 rounded border px-3 py-2 text-[12px] shadow-sm",
                t.tone === "success"
                  ? "border-[var(--color-success)]/40 bg-[var(--color-success-soft)] text-[var(--color-success)]"
                  : t.tone === "error"
                    ? "border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                    : "border-[var(--color-info)]/40 bg-[var(--color-info-soft)] text-[var(--color-info)]",
              ].join(" ")}
            >
              <Icon size={14} strokeWidth={2} className="mt-[1px] shrink-0" />
              <span className="leading-snug">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToasterProvider>");
  return ctx;
};

import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Cloudflare Turnstile global, injected by the api.js script.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/**
 * Cloudflare Turnstile loader — idempotent across remounts.
 * Resolves once the global `window.turnstile` is ready.
 */
let turnstileLoader: Promise<void> | undefined;
const loadTurnstile = (): Promise<void> => {
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => {
        turnstileLoader = undefined;
        reject(new Error("Turnstile script failed to load"));
      });
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.dataset.turnstile = "1";
    s.onload = () => resolve();
    s.onerror = () => {
      turnstileLoader = undefined;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return turnstileLoader;
};

export interface TurnstileWidgetHandle {
  /**
   * Force a fresh challenge (e.g. after a failed form submission — Turnstile
   * tokens are single-use). Emits `onToken(undefined)` until the user solves
   * the new challenge.
   */
  reset: () => void;
}

export interface TurnstileWidgetProps {
  /**
   * Public Turnstile site key (from the realm config or a public endpoint —
   * never ship the secret key to the browser).
   */
  siteKey: string;
  /**
   * Called with the challenge token once solved, and with `undefined` when
   * the token expires, errors out, or the widget is reset. Read the latest
   * value from state at submit time; tokens are single-use.
   */
  onToken: (token: string | undefined) => void;
  className?: string;
}

/**
 * Cloudflare Turnstile captcha widget (explicit render, SPA-friendly).
 *
 * Loads the api.js script once per page, renders the challenge into a div,
 * and reports token state through `onToken`. Pair with the server-side
 * `CaptchaProvider.verify()` from `alepha/captcha`.
 *
 * ```tsx
 * const [token, setToken] = useState<string | undefined>();
 * const widget = useRef<TurnstileWidgetHandle>(null);
 * {siteKey && <TurnstileWidget ref={widget} siteKey={siteKey} onToken={setToken} />}
 * // on submit failure: widget.current?.reset();
 * ```
 */
export function TurnstileWidget(
  props: TurnstileWidgetProps & { ref?: Ref<TurnstileWidgetHandle> },
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  // The render effect must not re-run when the parent passes a fresh
  // `onToken` arrow each render — route the latest callback through a ref.
  const onTokenRef = useRef(props.onToken);
  useEffect(() => {
    onTokenRef.current = props.onToken;
  }, [props.onToken]);

  useImperativeHandle(props.ref, () => ({
    reset: () => {
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.reset(id);
        } catch {}
      }
      onTokenRef.current(undefined);
    },
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    onTokenRef.current(undefined);
    let disposed = false;
    loadTurnstile()
      .then(() => {
        if (disposed || !window.turnstile || !el) return;
        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: props.siteKey,
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(undefined),
          "error-callback": () => onTokenRef.current(undefined),
        });
      })
      .catch(() => onTokenRef.current(undefined));
    return () => {
      disposed = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {}
      }
      widgetIdRef.current = undefined;
    };
  }, [props.siteKey]);

  return (
    <div ref={containerRef} data-testid="captcha" className={props.className} />
  );
}

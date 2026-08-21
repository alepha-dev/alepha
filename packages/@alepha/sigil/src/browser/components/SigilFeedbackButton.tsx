import { useEffect, useRef, useState } from "react";

import { SIGIL_FEEDBACK_CONTEXT_MAX_LEN } from "../../shared/sigilFeedbackContext.ts";
import {
  SIGIL_FEEDBACK_POSITION_DEFAULT,
  type SigilFeedbackPosition,
} from "../../shared/sigilFeedbackPosition.ts";
import { SIGIL_FEEDBACK_SUBMITTED_MESSAGE } from "../../shared/sigilMessages.ts";

/**
 * Props for the SigilFeedbackButton component.
 */
export interface SigilFeedbackButtonProps {
  /**
   * The sink-provided feedback URL (see `useFeedbackUrl()`). The host page's
   * context (see {@link collectPageContext}) is appended to it as a query
   * string before the popup opens.
   */
  feedbackUrl: string;
  /**
   * Which corner to sit in. Defaults to `bottom-right`, which is where the
   * button has always been.
   */
  position?: SigilFeedbackPosition;
}

/**
 * Floating feedback button.
 *
 * On click it synchronously opens `feedbackUrl` — the URL the sink handed
 * out via config — in a popup, with the host page's context appended as a
 * query string. There used to be a same-origin proxy here that resolved a
 * secret sigil id to a project server-side; there is no such id any more,
 * the sink now hands out a ready-to-use URL directly, so the popup can point
 * straight at it. Styled entirely inline — no stylesheet dependency.
 *
 * When the popup submits feedback it posts a
 * {@link SIGIL_FEEDBACK_SUBMITTED_MESSAGE} message back to this window and
 * closes itself; we flash a brief "thank you" pill above the button so the
 * user gets an acknowledgement once the popup is gone.
 */
export const SigilFeedbackButton = (props: SigilFeedbackButtonProps) => {
  const { feedbackUrl } = props;
  const [showThanks, setShowThanks] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  // One edge object for both the button and the "thank you" pill. They are
  // separate fixed-position elements, so a position applied to only one of them
  // detaches the pill from the button it belongs to.
  const position = props.position ?? SIGIL_FEEDBACK_POSITION_DEFAULT;
  const edge = position === "bottom-left" ? { left: 16 } : { right: 16 };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== SIGIL_FEEDBACK_SUBMITTED_MESSAGE) return;
      setShowThanks(true);
      if (hideTimer.current !== undefined) {
        window.clearTimeout(hideTimer.current);
      }
      hideTimer.current = window.setTimeout(() => setShowThanks(false), 3000);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (hideTimer.current !== undefined) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, []);

  const openFeedback = () => {
    const width = 480;
    const height = 720;
    // Center on the CURRENT monitor (screenLeft/Top + innerWidth/Height),
    // not just the primary screen — matters on multi-monitor setups.
    const dualLeft = window.screenLeft ?? window.screenX;
    const dualTop = window.screenTop ?? window.screenY;
    const viewportWidth =
      window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
    const viewportHeight =
      window.innerHeight ??
      document.documentElement.clientHeight ??
      screen.height;
    const left = Math.max(0, dualLeft + (viewportWidth - width) / 2);
    const top = Math.max(0, dualTop + (viewportHeight - height) / 2);

    const features = `width=${width},height=${height},left=${left},top=${top}`;
    // Carry the host page's context to the feedback form via the popup URL.
    // The Lore feedback page (`@alepha/sigil/context`) reads this same
    // whitelist back off the query string.
    const context = collectPageContext();
    const separator = feedbackUrl.includes("?") ? "&" : "?";
    const target = context
      ? `${feedbackUrl}${separator}${context}`
      : feedbackUrl;
    const popup = window.open(target, "lore-feedback", features);
    if (!popup) window.open(target, "_blank");
  };

  return (
    <>
      {showThanks && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 68,
            ...edge,
            zIndex: 2147483000,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            background: "#111827",
            color: "#fff",
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1,
            borderRadius: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,.25)",
            pointerEvents: "none",
          }}
        >
          {/* lucide Check */}
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#34d399"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Thank you!
        </div>
      )}
      <button
        type="button"
        aria-label="Feedback"
        onClick={openFeedback}
        style={{
          position: "fixed",
          bottom: 16,
          ...edge,
          zIndex: 2147483000,
          width: 44,
          height: 44,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
          color: "#fff",
          border: 0,
          borderRadius: 9999,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,.25)",
        }}
      >
        {/* lucide MessageSquareWarning — chat bubble with a "!" */}
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
      </button>
    </>
  );
};

/**
 * Snapshot the host page's context (URL, title, referrer, UA, locale, viewport)
 * as a query string the popup carries to the feedback form. Best-effort: any
 * field that throws or is unavailable is simply omitted. Each value is capped
 * so a hostile/huge value can't blow out the popup URL — the server schema
 * enforces the authoritative bounds on persist. Keys match
 * `SIGIL_FEEDBACK_CONTEXT_PARAMS`.
 */
const collectPageContext = (): string => {
  const params = new URLSearchParams();
  const put = (key: string, value: string | undefined | null) => {
    if (value) params.set(key, value.slice(0, SIGIL_FEEDBACK_CONTEXT_MAX_LEN));
  };
  try {
    put("url", window.location.href);
    put("path", window.location.pathname + window.location.search);
    put("title", document.title);
    put("ref", document.referrer);
    put("ua", navigator.userAgent);
    put("lang", navigator.language);
    put("vp", `${window.innerWidth}x${window.innerHeight}`);
    put("scr", `${window.screen.width}x${window.screen.height}`);
    put("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    // Best-effort — a missing global just means fewer context fields.
  }
  return params.toString();
};

import { useEffect, useRef, useState } from "react";

import {
  SIGIL_FEEDBACK_CONTEXT_MAX_LEN,
  type SigilFeedbackContextParam,
} from "../../shared/sigilFeedbackContext.ts";
import {
  SIGIL_FEEDBACK_POSITION_DEFAULT,
  type SigilFeedbackPosition,
} from "../../shared/sigilFeedbackPosition.ts";
import {
  SIGIL_FEEDBACK_SHAPE_DEFAULT,
  type SigilFeedbackShape,
} from "../../shared/sigilFeedbackShape.ts";
import {
  SIGIL_FEEDBACK_THEME_DEFAULT,
  type SigilFeedbackTheme,
} from "../../shared/sigilFeedbackTheme.ts";
import { SIGIL_FEEDBACK_SUBMITTED_MESSAGE } from "../../shared/sigilMessages.ts";
import { sigilScrubUrl } from "../../shared/sigilScrubUrl.ts";
import { sigilUserAgent } from "../../shared/sigilUserAgent.ts";
import { SIGIL_FEEDBACK_BUTTON_CSS } from "./sigilFeedbackButtonCss.ts";

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
  /**
   * A round `circle` (the default), a `pill` with a label, or a `tab` on the
   * edge of the page. A tab sits at mid-height, so `position` only picks its
   * side.
   */
  shape?: SigilFeedbackShape;
  /**
   * The colour preset. Defaults to `indigo`.
   */
  theme?: SigilFeedbackTheme;
}

/**
 * Floating feedback button.
 *
 * On click it synchronously opens `feedbackUrl` — the URL the sink handed
 * out via config — in a popup, with the host page's context appended as a
 * query string. There used to be a same-origin proxy here that resolved a
 * secret sigil id to a project server-side; there is no such id any more,
 * the sink now hands out a ready-to-use URL directly, so the popup can point
 * straight at it. It renders its own `<style>` element (see
 * `sigilFeedbackButtonCss.ts`), so the host app imports no stylesheet.
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

  // One side and one shape for both the button and the "thank you" pill. They
  // are separate fixed-position elements, so a placement applied to only one of
  // them detaches the pill from the button it belongs to.
  const position = props.position ?? SIGIL_FEEDBACK_POSITION_DEFAULT;
  const side = position === "bottom-left" ? "left" : "right";
  const shape = props.shape ?? SIGIL_FEEDBACK_SHAPE_DEFAULT;
  const theme = props.theme ?? SIGIL_FEEDBACK_THEME_DEFAULT;

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
    // The Lore feedback page (`@alepha/lore`) reads this same
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
      <style>{SIGIL_FEEDBACK_BUTTON_CSS}</style>
      {showThanks && (
        <div
          role="status"
          aria-live="polite"
          className="alepha-sigil-fb-thanks"
          data-shape={shape}
          data-side={side}
        >
          {/* lucide Check */}
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
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
        title="Send feedback"
        onClick={openFeedback}
        className="alepha-sigil-fb"
        data-shape={shape}
        data-theme={theme}
        data-side={side}
      >
        {/* lucide MessageSquare. A plain bubble: the "!" it used to carry read
            as a warning about the page rather than an invitation to write. */}
        {shape !== "tab" && (
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        {shape !== "circle" && (
          <span className="alepha-sigil-fb-label">Feedback</span>
        )}
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
 *
 * Three of the values are reduced before they leave the page, and none of the
 * three ever needed to be whole:
 *
 * - `url` goes through {@link sigilScrubUrl}, the same treatment an error's
 *   `sourceUrl` gets. Query strings hold reset tokens, invite codes and email
 *   addresses; fragments hold OAuth implicit-flow access tokens. Feedback sent
 *   from `/reset?token=abc` used to ship the token to a third-party form that
 *   persists it verbatim, where every member of the receiving project can read
 *   it.
 * - `path` is the pathname alone, for the same reason: it used to append
 *   `location.search`, which is the very thing `url` is scrubbed of.
 * - `ua` goes through {@link sigilUserAgent}. A full user-agent string is one
 *   of the highest-entropy identifiers a browser hands out; the browser family,
 *   its major version and the OS are what a bug report is read for.
 */
const collectPageContext = (): string => {
  const params = new URLSearchParams();
  const put = (
    key: SigilFeedbackContextParam,
    value: string | undefined | null,
  ) => {
    if (value) params.set(key, value.slice(0, SIGIL_FEEDBACK_CONTEXT_MAX_LEN));
  };
  try {
    put("url", sigilScrubUrl(window.location.href));
    put("path", window.location.pathname);
    put("title", document.title);
    put("ref", document.referrer);
    put("ua", sigilUserAgent(navigator.userAgent));
    put("lang", navigator.language);
    put("vp", `${window.innerWidth}x${window.innerHeight}`);
    put("scr", `${window.screen.width}x${window.screen.height}`);
    put("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    // Best-effort — a missing global just means fewer context fields.
  }
  return params.toString();
};

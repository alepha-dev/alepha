/**
 * The trail a sigil feedback report carries (#Q4038): what went wrong just
 * before and how the visitor got there, kept in memory by the browser
 * sigil and handed to the feedback popup only when the visitor files a
 * report. Never stored on the page, never sent on its own.
 *
 * Shared by three parties that must agree on it: the sigil's buffer, the
 * feedback button that answers the popup, and the Lore feedback page that
 * asks for it. The server (`feedbackSourceSchema.trail`) re-validates every
 * bound: like every `source` field it is attacker-controlled.
 *
 * Kept React-free and browser-API-free, so any side imports it.
 */
export interface SigilFeedbackTrail {
  /**
   * The last crashes, newest last: the same filter as the error queue, so a
   * mistyped password or a 403 is never one.
   */
  errors: Array<{ message: string; path: string; at: number }>;
  /**
   * The last paths visited, newest last, without query or fragment.
   */
  pages: Array<{ path: string; at: number }>;
  /**
   * The last named actions: name, outcome and duration. Never arguments or
   * responses, and never an action without an `id` (#Q4106).
   */
  actions: Array<{
    name: string;
    outcome: "success" | "error";
    ms: number;
  }>;
}

/**
 * The caps, client and server alike.
 */
export const SIGIL_FEEDBACK_TRAIL_LIMITS = {
  errors: 5,
  pages: 5,
  actions: 5,
  message: 500,
  path: 500,
  name: 100,
} as const;

/**
 * The popup, opened by the button, asks its opener for the trail.
 */
export const SIGIL_FEEDBACK_READY_MESSAGE = "alepha-sigil:feedback:ready";

/**
 * The button answers the popup with the trail.
 */
export const SIGIL_FEEDBACK_TRAIL_MESSAGE = "alepha-sigil:feedback:trail";

/**
 * `postMessage` contract between the in-popup Lore feedback page and the host
 * app's embedded sigil feedback button.
 *
 * When the feedback page is opened as a popup
 * (`window.open(..., "lore-feedback", ...)`), a successful submit posts this
 * message to `window.opener` and then closes the popup instantly. The button
 * (on the host page) listens for it and flashes a brief "thank you"
 * acknowledgement — the only feedback the user gets once the popup is gone.
 *
 * Importable React-free via `@alepha/sigil/messages` so the Lore feedback page
 * can share the exact string without pulling the module barrel.
 */
export const SIGIL_FEEDBACK_SUBMITTED_MESSAGE =
  "alepha-sigil:feedback:submitted";

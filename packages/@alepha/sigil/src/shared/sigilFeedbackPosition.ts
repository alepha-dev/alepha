/**
 * Which corner the floating feedback button occupies.
 *
 * An enum rather than a `feedbackLeft: boolean` — the top corners are the
 * obvious next request and a boolean cannot grow to hold them.
 *
 * The value reaches a `style` on a third-party page, so it is never trusted as
 * it arrives: {@link sigilFeedbackPositionOf} maps anything unrecognised back
 * to the default rather than letting it through.
 */
export type SigilFeedbackPosition = "bottom-right" | "bottom-left";

export const SIGIL_FEEDBACK_POSITIONS: SigilFeedbackPosition[] = [
  "bottom-right",
  "bottom-left",
];

export const SIGIL_FEEDBACK_POSITION_DEFAULT: SigilFeedbackPosition =
  "bottom-right";

/**
 * The config value meaning "render no button at all".
 *
 * Deliberately NOT a member of {@link SIGIL_FEEDBACK_POSITIONS}, because it is
 * not a place. It is a separate constant so the one component that must branch
 * on it can name it, rather than comparing against a string literal that reads
 * like a corner it forgot to handle.
 */
export const SIGIL_FEEDBACK_HIDDEN = "hidden";

/**
 * Narrow an arbitrary string to a position, falling back to the default.
 *
 * `undefined` is the normal case, not an error: the column backing this is
 * nullable so that every sigil predating it keeps the original bottom-right
 * placement with no backfill.
 */
export const sigilFeedbackPositionOf = (
  value: string | undefined,
): SigilFeedbackPosition =>
  SIGIL_FEEDBACK_POSITIONS.includes(value as SigilFeedbackPosition)
    ? (value as SigilFeedbackPosition)
    : SIGIL_FEEDBACK_POSITION_DEFAULT;

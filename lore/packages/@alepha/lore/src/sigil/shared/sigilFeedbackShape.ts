/**
 * What the floating feedback button looks like, apart from its colours.
 *
 * - `circle`: an icon in a round button, where the button has always been.
 * - `pill`: the icon and a "Feedback" label, for a control that says what it is.
 * - `tab`: a vertical tab at mid-height on the edge of the page. The corner in
 *   `feedbackButton` only picks the side then, since a tab has no corner.
 *
 * Like the position, the value reaches markup on a third-party page, so it is
 * never trusted as it arrives: {@link sigilFeedbackShapeOf} maps anything
 * unrecognised back to the default.
 */
export type SigilFeedbackShape = "circle" | "pill" | "tab";

export const SIGIL_FEEDBACK_SHAPES: SigilFeedbackShape[] = [
  "circle",
  "pill",
  "tab",
];

export const SIGIL_FEEDBACK_SHAPE_DEFAULT: SigilFeedbackShape = "circle";

/**
 * Narrow an arbitrary string to a shape, falling back to the default.
 *
 * `undefined` is the normal case: an app that sets no
 * `SIGIL_CONFIG.feedbackButtonShape` keeps the circle.
 */
export const sigilFeedbackShapeOf = (
  value: string | undefined,
): SigilFeedbackShape =>
  SIGIL_FEEDBACK_SHAPES.includes(value as SigilFeedbackShape)
    ? (value as SigilFeedbackShape)
    : SIGIL_FEEDBACK_SHAPE_DEFAULT;

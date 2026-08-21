import { type Infer, z } from "alepha";

import { SIGIL_FEEDBACK_POSITIONS } from "../sigilFeedbackPosition.ts";

/**
 * What an app collects.
 *
 * Only that. Where it reports is `SIGIL_SINK`, and which project it reports
 * into is carried by `SIGIL_KEY` itself, so everything left here is a switch
 * with a working default and the whole variable is optional. An app enrols by
 * setting one secret.
 *
 * ## Why the switches are one variable and not eight
 *
 * They are edited together or not at all, and flat names cannot express the
 * button position and the excluded paths without turning into a family that
 * has to be kept in sync by hand. The two fields that left were the two that
 * broke the pattern: a sink origin and a project slug are not switches, they
 * are identity, and identity was being asked of an operator twice.
 *
 * ## Why not fetched from the sink
 *
 * That was tried, and it made the sink the control plane, which reads well
 * until the two runtimes are considered. On a serverless host the isolate is
 * discarded between requests, so the cached config is unset on nearly every one
 * and the fetch happens again; and because it was awaited before rendering, the
 * first byte of every cold page waited on a round trip to the sink. On a
 * prerendered app the same hook runs during the *build*, so the answer was
 * baked into the HTML and could not change until the next deploy, which is a
 * kill-switch that needs a redeploy and therefore the exact thing the fetch
 * existed to avoid.
 *
 * An environment variable has neither problem and keeps what mattered: on a
 * platform with a dashboard it is editable in seconds, without CI, which is all
 * "change it in production" ever meant.
 *
 * ## Every field is single-typed on purpose
 *
 * A `boolean | number` would read naturally here (`analytics: 0.25` for a
 * sampling rate) and would then have to be narrowed at every use. If sampling
 * is wanted, it arrives as its own numeric field.
 */
export const sigilConfig = z.object({
  /** Page views. */
  analytics: z.boolean().default(true),

  /** Client and server errors. */
  blights: z.boolean().default(true),

  /** Web-vitals samples. */
  vitals: z.boolean().default(true),

  /**
   * Whether the app offers a feedback link at all.
   *
   * Distinct from {@link feedbackButton}: this decides whether there is a URL,
   * that decides whether this package renders a control for it. An app that
   * wants the link in its own header sets `feedback: true` with the button
   * `hidden` and reads `useFeedbackUrl()`.
   *
   * On by default, and still silent on an app whose key names no project:
   * there is no URL to build then, so there is nothing to render.
   */
  feedback: z.boolean().default(true),

  /** Where the built-in feedback button sits, or `hidden` to render none. */
  feedbackButton: z
    .enum(["hidden", ...SIGIL_FEEDBACK_POSITIONS])
    .default("bottom-right"),

  /**
   * Pages the button stays off, as path globs: `*` within a segment, `**`
   * across them, anchored at both ends.
   *
   * The obvious entry is the feedback page itself, where the button would
   * offer to take a reader somewhere they already are.
   *
   * Config rather than app code, because it is a judgement about pages rather
   * than a fact about routes: which pages a floating button gets in the way of
   * is exactly the sort of thing noticed after a deploy, by someone reading
   * the site rather than building it.
   */
  feedbackButtonExcludedPaths: z.array(z.text()).default([]),
});

export type SigilConfig = Infer<typeof sigilConfig>;

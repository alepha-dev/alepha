import { type Infer, z } from "alepha";
import { SIGIL_FEEDBACK_POSITIONS } from "../sigilFeedbackPosition.ts";

/** The commons an app reports to when it names no other. */
export const SIGIL_DEFAULT_SINK = "https://lore.alepha.dev";

/**
 * What an app collects, and where it sends it.
 *
 * One structured environment variable rather than a set of flat ones, and
 * rather than something fetched from the sink at runtime. Both of those were
 * tried:
 *
 * Flat variables cannot express `project`, a button position and a set of
 * switches without turning into eight names that must be edited together.
 *
 * A runtime fetch was worse in a way that took longer to see. It made the sink
 * the control plane, which reads well — until the two runtimes are considered.
 * On a serverless host the isolate is discarded between requests, so the cached
 * config is unset on nearly every one and the fetch happens again; and because
 * it was awaited before rendering, the first byte of every cold page waited on
 * a round trip to the sink. On a prerendered app the same hook runs during the
 * *build*, so the answer was baked into the HTML and could not change until the
 * next deploy — a kill-switch that needs a redeploy, which is the exact thing
 * the fetch existed to avoid.
 *
 * An environment variable has neither problem and keeps what mattered: on a
 * platform with a dashboard it is editable in seconds, without CI, which is all
 * "change it in production" ever meant. It also collapses two control planes
 * into one — the deploy already owns every other setting, and a sink that grows
 * a deploy feature governs this the same way it governs the rest, instead of
 * through a protocol only this package speaks.
 *
 * Every field is single-typed on purpose. A `boolean | number` would read
 * naturally here (`analytics: 0.25` for a sampling rate) and would then have to
 * be narrowed at every use. If sampling is wanted, it arrives as its own
 * numeric field.
 */
export const sigilConfig = z.object({
  /**
   * The sink-side project this app reports into.
   *
   * Required, and the reason the app needs no round trip before it can render
   * a feedback link: the URL is `{sink}/{project}/request`, which the sink used
   * to have to hand back because only it knew the slug.
   *
   * It is a second name for something the credential already identifies, so the
   * sink is expected to reject an envelope whose declared project disagrees
   * with its token. Silently accepting the mismatch would send telemetry to one
   * project while pointing readers at another's feedback form.
   */
  project: z.text({
    description: "Sink-side project slug this app reports into.",
  }),

  /** Page views. */
  analytics: z.boolean().default(true),

  /** Client and server errors. */
  blights: z.boolean().default(true),

  /** Web-vitals samples. */
  vitals: z.boolean().default(true),

  /**
   * Whether the sink offers this app a feedback link at all.
   *
   * Distinct from {@link feedbackButton}: this decides whether there is a URL,
   * that decides whether this package renders a control for it. An app that
   * wants the link in its own header sets `feedback: true` with the button
   * `hidden` and reads `useFeedbackUrl()`.
   */
  feedback: z.boolean().default(true),

  /** Where the built-in feedback button sits, or `hidden` to render none. */
  feedbackButton: z
    .enum(["hidden", ...SIGIL_FEEDBACK_POSITIONS])
    .default("bottom-right"),

  /**
   * Pages the button stays off, as path globs — `*` within a segment, `**`
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

  /**
   * Origin of the sink.
   *
   * Defaults to the public instance the way `npm` defaults to
   * `registry.npmjs.org`: a commons that is there if you want it and one field
   * away if you do not. Safe to carry as a default precisely because it does
   * nothing alone — a key is still minted deliberately by whichever instance
   * you chose, and a key from a self-hosted sink simply 401s against the public
   * one rather than leaking into it.
   */
  sink: z.text({ default: SIGIL_DEFAULT_SINK }),
});

export type SigilConfig = Infer<typeof sigilConfig>;

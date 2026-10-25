import { type Infer, z } from "alepha";

/**
 * The longest a single excluded-path glob may be, and how many of them fit.
 *
 * Bounded rather than truncated, like every other cap on this wire: a
 * truncated glob is not a shorter rule, it is a different one.
 */
const MAX_GLOB_LENGTH = 256;
const MAX_GLOBS = 50;

/**
 * What an app says it is configured to do, as it ended up after defaults.
 *
 * ## Why the sink cannot work this out for itself
 *
 * `SIGIL_CONFIG` lives in the app's environment and is read only by the app.
 * Config polling was deleted when `SIGIL_KEY` became the whole enrolment, and
 * that decision holds: a fetched config survives neither a serverless isolate
 * nor a prerender. The consequence is that a sink knows what it RECEIVES and
 * nothing about what the app DECIDED, so an app quietly sending nothing and an
 * app the sink is quietly refusing look identical from the sink's side. This
 * is the app volunteering the missing half.
 *
 * ## Resolved, not raw
 *
 * What is sent is the config after defaults are applied, never the
 * `SIGIL_CONFIG` string. The raw value is what an operator typed; the resolved
 * value is what is running, and only the second one explains behaviour. An app
 * that sets nothing at all still reports a full answer, which is the point:
 * "unset" and "everything on" are the same running state and should read the
 * same.
 *
 * ## It is a claim, not a fact
 *
 * The envelope is accepted from anyone holding a sigil token, so every field
 * here is what the app SAYS. It must never become an authorization input, never
 * feed an ingest gate, and never overwrite the sink's own record of what it
 * accepts. Its whole value is being displayed NEXT TO that record, so that a
 * disagreement - this app is sending vitals and the sink is refusing them - is
 * visible instead of silent.
 *
 * ## `trackers` is a map, not five booleans
 *
 * Keyed by `SIGIL_TRACKERS` so a tracker added later needs no schema
 * change on either end, and an older sink renders whatever it is given without
 * knowing the names. The same shape, for the same reason, as the browser
 * config's `enabled`.
 */
export const sigilReportedConfig = z.object({
  /**
   * Which trackers the app has switched on, by tracker name.
   */
  trackers: z.record(z.string().max(32), z.boolean()),
  /**
   * Whether the app offers a feedback link at all. Distinct from where the
   * built-in button sits, which is {@link feedbackButton}.
   */
  feedback: z.boolean(),
  /**
   * Where the built-in feedback button sits, or `hidden` for none.
   *
   * Free text rather than the position enum: a sink and an app deploy
   * independently, and a sink that rejected a position it had not heard of
   * would refuse a whole batch over a cosmetic field.
   */
  feedbackButton: z.string().max(32),
  feedbackButtonExcludedPaths: z
    .array(z.string().max(MAX_GLOB_LENGTH))
    .max(MAX_GLOBS),
  /**
   * Whether this process reports from outside production.
   *
   * Worth carrying because it explains a whole class of "why is my staging
   * dashboard empty": the answer is almost always this switch, and it is
   * otherwise invisible to everyone but whoever can read the app's env.
   */
  reportOutsideProduction: z.boolean(),
});

export type SigilReportedConfig = Infer<typeof sigilReportedConfig>;

/**
 * Bounds an untrusted reported config, or refuses it.
 *
 * Run at BOTH ends, the way {@link sigilHost} is, and for the same reason: the
 * sender is whoever holds the token, so what the sink receives is whatever a
 * process chose to put on the wire, and the value lands in a rendered page.
 * Refuses an unshaped or over-long payload rather than truncating it - a
 * truncated exclusion list is a different configuration, not a shorter one.
 *
 * `undefined` in, `undefined` out: an older client sends nothing, which is not
 * an error and must read downstream as "this app has not told us" rather than
 * as "everything is off".
 */
export const sigilNormalizeReportedConfig = (
  value: unknown,
): SigilReportedConfig | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;

  const trackers: Record<string, boolean> = {};
  const reported = raw.trackers;
  if (!reported || typeof reported !== "object" || Array.isArray(reported)) {
    return undefined;
  }
  for (const [name, on] of Object.entries(
    reported as Record<string, unknown>,
  )) {
    // A name this sink has never heard of is kept, not dropped: the sender may
    // be newer than the sink, and a tracker rendered as an unfamiliar row is
    // more useful than one silently missing. Bounded, because it is a key in a
    // record that gets rendered.
    if (typeof on !== "boolean" || !name || name.length > 32) {
      return undefined;
    }
    trackers[name] = on;
  }

  const paths = raw.feedbackButtonExcludedPaths;
  if (!Array.isArray(paths) || paths.length > MAX_GLOBS) {
    return undefined;
  }
  for (const glob of paths) {
    if (typeof glob !== "string" || glob.length > MAX_GLOB_LENGTH) {
      return undefined;
    }
  }

  if (
    typeof raw.feedback !== "boolean" ||
    typeof raw.reportOutsideProduction !== "boolean" ||
    typeof raw.feedbackButton !== "string" ||
    raw.feedbackButton.length > 32
  ) {
    return undefined;
  }

  return {
    trackers,
    feedback: raw.feedback,
    feedbackButton: raw.feedbackButton,
    feedbackButtonExcludedPaths: paths as string[],
    reportOutsideProduction: raw.reportOutsideProduction,
  };
};

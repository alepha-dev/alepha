import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

/**
 * How long a deployed copy may say nothing before it counts as silent.
 *
 * A day rather than an hour: a copy with real but thin traffic can go a few
 * hours between batches without anything being wrong, and a badge that lights
 * up overnight on a low-traffic staging deployment teaches its owner to ignore
 * it.
 *
 * ⚠️ **One export, and that is the point of this file.** It was defined twice,
 * in `ProjectApps.tsx` and in `AppDashboardIdentity.tsx`, each with a comment
 * claiming to share the other's value. Two constants that must agree and
 * cannot check each other is how the list and the Overview end up disagreeing
 * about what silent means.
 */
export const SILENT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The three states a deployed copy can be in, as far as reporting goes.
 *
 * ⚠️ **`none` is not a fault**, and separating it is the whole reason this
 * function exists. The old `isSilent` read `!lastSeenAt || now - lastSeenAt >
 * 24h`, so an instance with no sigil has no `lastSeenAt`, never will, and
 * rendered as silent forever - the UI reporting a fault where there is a
 * configuration.
 */
export type AppLiveness = "reporting" | "silent" | "none";

/**
 * Whether this copy is reporting, has gone quiet, or was never wired up.
 *
 * Takes `now` rather than reading a clock, so a caller holding
 * `DateTimeProvider` passes `nowMillis()` and the function stays testable
 * without one.
 */
export const appLiveness = (
  instance: AppInstanceResource,
  now: number,
): AppLiveness => {
  const lastSeenAt = instance.sigil?.lastSeenAt;
  if (!instance.sigil) {
    return "none";
  }
  if (!lastSeenAt) {
    return "silent";
  }
  return now - new Date(lastSeenAt).getTime() > SILENT_AFTER_MS
    ? "silent"
    : "reporting";
};

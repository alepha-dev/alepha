import type { DateTimeProvider } from "alepha/datetime";
import type { BayApp } from "../../api/services/BayControlService.ts";

/**
 * How long an app must go unused before saying so is useful rather than noisy.
 *
 * Thirty days, not seven. A prototype nobody touched for a week is normal — a
 * holiday, a sprint spent elsewhere, a demo that runs monthly. A badge that
 * fires on all of those is one people learn to scroll past, which costs more
 * than never having shown it at all.
 */
export const QUIET_AFTER_DAYS = 30;

/**
 * Matches a Bay release directory name, `2006-01-02-150405` in UTC.
 */
const RELEASE_STAMP = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/;

/**
 * Says how long an app has gone unused, or nothing when that is not worth
 * saying.
 *
 * Falls back to the release timestamp when the app has never answered at all.
 * Without that fallback the two ends of the scale collapse into one: an app
 * deployed forty seconds ago and an app deployed in March and never once
 * opened both have no `lastRequestAt`, and only one of them is a candidate for
 * deletion. Dating the silence from the deploy separates them, and it has the
 * happy side effect that a fresh deploy is never badged.
 *
 * Reports the cron count alongside, when there is one. An app whose entire job
 * is a weekly mailer answers nobody and would otherwise read as the deadest
 * thing on the host — this is what stops it being deleted on that reading.
 */
export const quietLabel = (
  app: BayApp,
  dt: DateTimeProvider,
): string | undefined => {
  const since = app.lastRequestAt ?? releaseDate(app.release);
  if (!since) {
    return undefined;
  }
  if (dt.now().diff(dt.of(since), "day") < QUIET_AFTER_DAYS) {
    return undefined;
  }
  const quiet = `Quiet ${dt.of(since).fromNow(true)}`;
  // `crons` is absent on an older bay-go, and absent means unknown, not none.
  // Saying nothing is right: claiming an app has no scheduled work, when
  // nobody actually asked, is the false reassurance that gets it deleted.
  if (!app.crons) {
    return quiet;
  }
  return `${quiet} · ${app.crons} cron${app.crons > 1 ? "s" : ""}`;
};

/**
 * Turns a release directory name into something parseable.
 */
const releaseDate = (release: string | undefined): string | undefined => {
  const parts = RELEASE_STAMP.exec(release ?? "");
  if (!parts) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
};

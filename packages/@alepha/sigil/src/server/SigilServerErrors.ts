import { $hook, $inject } from "alepha";
// Type-only, and deliberately so: it loads the module augmentation that
// declares `job:error` without pulling the jobs runtime into an app that has
// none. The hook simply never fires there.
import type {} from "alepha/api/jobs";
import { SigilSinkProvider } from "./SigilSinkProvider.ts";

/**
 * Feeds server-side failures into the same pipeline as the browser's, tagged
 * `origin: "server"`.
 *
 * Handed to the sink provider rather than sent directly, so a server-side crash
 * loop is aggregated by fingerprint exactly like a client one — which is the
 * case that matters most, since a failing endpoint can produce thousands of
 * identical errors a minute.
 *
 * Two sources, both Alepha's own events rather than a process-level trap:
 * `server:onError` for requests and `job:error` for background work. Staying
 * inside the framework's events is what keeps this reportable — an
 * `uncaughtException` handler would fire for anything in the process,
 * including things no app author can act on.
 */
export class SigilServerErrors {
  protected readonly sink = $inject(SigilSinkProvider);

  protected readonly onError = $hook({
    on: "server:onError",
    handler: async ({ route, error }) => {
      if (!this.isCrash(error)) return;

      await this.sink.ingest({
        errors: [this.toError(error, route?.path ?? "")],
      });
    },
  });

  /**
   * A background job that threw.
   *
   * Worth reporting for a reason requests are not: nobody is watching. A failed
   * request produces a bad response somebody notices; a cron that has been
   * failing every night for a week produces silence, and the first sign is the
   * work not having been done.
   *
   * No status to filter on — a job either completed or it did not.
   */
  protected readonly onJobError = $hook({
    on: "job:error",
    handler: async ({ name, error }) => {
      await this.sink.ingest({
        errors: [this.toError(error, `job:${name}`)],
      });
    },
  });

  /**
   * Whether this is a fault rather than a refusal.
   *
   * **Every 4xx is dropped.** They are the app working: 400 is bad input, 404
   * is a path that does not exist, 401 and 403 are a logged-out or
   * under-privileged visitor, 409 is a conflict the caller has to resolve. On
   * anything reachable from the internet these arrive constantly — a scanner
   * alone produces hundreds of 404s a day — and a crash inbox that lists them
   * is an inbox nobody opens, which costs the 5xx sitting underneath.
   *
   * Kept: 5xx, and anything with no status at all. A missing status means the
   * error never reached the point of becoming a response, which is the
   * definition of a crash.
   *
   * Someone who wants to know how many 404s a route serves wants request
   * analytics. That is a different product and deliberately not this one.
   */
  protected isCrash(error: unknown): boolean {
    const status = (error as { status?: number } | undefined)?.status;
    if (typeof status !== "number") return true;
    return status >= 500;
  }

  protected toError(error: Error | undefined, sourceUrl: string) {
    return {
      name: error?.name ?? "Error",
      message: String(error?.message ?? "").slice(0, 2000),
      stack: String(error?.stack ?? "").slice(0, 4096),
      sourceUrl,
      origin: "server" as const,
    };
  }
}

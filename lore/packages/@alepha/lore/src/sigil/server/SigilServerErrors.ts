import { $hook, $inject, Alepha } from "alepha";
// Type-only, and deliberately so: it loads the module augmentation that
// declares `job:error` without pulling the jobs runtime into an app that has
// none. The hook simply never fires there.
import type {} from "alepha/api/jobs";

import { sigilScrubUrl } from "../shared/sigilScrubUrl.ts";
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
 * Three sources, all Alepha's own events rather than a process-level trap:
 * `server:request:error` for requests, `job:error` for background work, and `log:entry`
 * for every entry logged at error level, so a failure the code caught, logged
 * and carried on from still reaches Lore. Staying inside the framework's
 * events is what keeps this reportable — an `uncaughtException` handler would
 * fire for anything in the process, including things no app author can act
 * on.
 *
 * One failure is one report, whichever hooks see it: every `Error` ingested
 * is remembered, so the 5xx that `server:request:error` reports and the "Request
 * has failed" line the server logs for it arrive once.
 */
export class SigilServerErrors {
  protected readonly alepha = $inject(Alepha);
  protected readonly sink = $inject(SigilSinkProvider);

  /**
   * Context key marking code that runs inside an ingest, so an error it logs
   * is not fed back into the sink it came from.
   */
  protected static readonly INGESTING = "sigil.server.ingesting";

  /**
   * Where the server keeps the route pattern of the request being served
   * (`ServerRouterProvider.ROUTE_KEY`). Spelled out rather than imported:
   * hosts run this sigil on their own `alepha`, and one older than the key
   * simply reports no route.
   */
  protected static readonly ROUTE_KEY = "alepha.server.route";

  /**
   * How many causes deep a report follows `error.cause`, and how much of the
   * stack the chain may take: a cause chain is short in practice, and a
   * cyclic or runaway one must not crowd the frames out.
   */
  protected static readonly MAX_CAUSES = 5;
  protected static readonly MAX_CAUSE_CHARS = 1024;

  /**
   * The `Error`s already reported, by identity. Weak, so a report never keeps
   * an error alive.
   */
  protected readonly reported = new WeakSet<object>();

  protected readonly onError = $hook({
    on: "server:request:error",
    handler: async ({ route, error }) => {
      if (!this.isCrash(error)) return;
      if (!this.claim(error)) return;

      await this.ingest(this.toError(error, route?.path ?? ""));
    },
  });

  /**
   * An entry logged at error level.
   *
   * A log is how a best-effort step reports that it failed and was
   * swallowed: no request fails and no job throws, so without this nothing
   * reaches Lore. Warnings and below stay out, which is why an expected
   * condition logs at `warn`.
   */
  protected readonly onLog = $hook({
    on: "log:entry",
    handler: async ({ entry }) => {
      if (entry.level !== "ERROR") return;
      if (this.alepha.context.get(SigilServerErrors.INGESTING)) return;

      // The route the request was on, when this was logged during one: a
      // logged error's stack often ends at an async boundary, and the route
      // is what says which page or action asked (#Q3760).
      const route = this.alepha.context.get<string>(
        SigilServerErrors.ROUTE_KEY,
      );
      const sourceUrl = route
        ? `log:${entry.module} ${route}`
        : `log:${entry.module}`;
      const error = this.errorOf(entry.data);
      if (!error) {
        const message = String(entry.message ?? "").slice(0, 2000);
        await this.ingest({
          name: "Error",
          message,
          // No stack to fingerprint on: the message stands in for the throw
          // site, so two different messages are two errors, and a message
          // logged again bumps its own count (#Q4329). An empty stack put
          // every message-only log in one group.
          stack: message,
          sourceUrl: sigilScrubUrl(sourceUrl),
          origin: "server" as const,
        });
        return;
      }
      if (!this.isCrash(error)) return;
      if (!this.claim(error)) return;

      await this.ingest(
        this.toError(error, sourceUrl, String(entry.message ?? "")),
      );
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
      if (!this.claim(error)) return;

      await this.ingest(this.toError(error, `job:${name}`));
    },
  });

  /**
   * Record `error` as reported, and say whether it was new.
   *
   * Anything that is not an object cannot be remembered, and is always new.
   */
  protected claim(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return true;
    if (this.reported.has(error)) return false;
    this.reported.add(error);
    return true;
  }

  /**
   * The `Error` a log entry carries: its data, or its data's `error` field,
   * which is how `log.error("message", { error })` passes one.
   */
  protected errorOf(data: unknown): Error | undefined {
    if (data instanceof Error) return data;
    const nested = (data as { error?: unknown } | undefined)?.error;
    return nested instanceof Error ? nested : undefined;
  }

  /**
   * Hand one error to the sink, marked so that anything logged at error level
   * while it runs (a flush that fails, say) is not reported back into it.
   */
  protected ingest(error: ReturnType<SigilServerErrors["toError"]>) {
    return this.alepha.context.nest(async () => {
      this.alepha.context.set(SigilServerErrors.INGESTING, true);
      await this.sink.ingest({ errors: [error] });
    });
  }

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

  /**
   * `sourceUrl` is scrubbed for the same reason it is on the browser side, even
   * though what reaches it today — a route pattern like `/users/:id`, or
   * `job:<name>` — carries nothing. The invariant worth holding is that every
   * `sourceUrl` in an envelope has been through {@link sigilScrubUrl}; leaving
   * one path exempt because its current caller happens to be safe is how the
   * exemption outlives the reason for it.
   */
  /**
   * The report for one error.
   *
   * `logged` is the message of the log line that carried it, kept in front
   * of the error's own (`SSR rendering error: Query select has failed`):
   * the line says what was being done, the error what went wrong.
   *
   * The cause chain is appended to the stack, one `Caused by: name: message`
   * line per level, after the frames (#Q3760). A wrapper such as `DbError`
   * says a query failed; its cause says why (no such column, too many
   * variables), and dropping it left reports nobody could triage.
   *
   * ⚠️ **Fingerprints do not move.** A fingerprint is the error's name and
   * its first `at` frame (`sigilFingerprintSource`); the chain comes
   * after every frame and the logged message goes into `message`, so an
   * existing group keeps collecting the same error. Another cause under the
   * same wrapper and frame stays in that group too, by choice: it is the same
   * call failing, and splitting a long-standing group on a driver's wording
   * would lose its history. The cause is on each report, which is where
   * triage reads it.
   *
   * Every field stays capped as the envelope requires: the chain takes at
   * most `MAX_CAUSE_CHARS` of the stack's 4096, the frames the rest.
   */
  protected toError(
    error: Error | undefined,
    sourceUrl: string,
    logged?: string,
  ) {
    const own = String(error?.message ?? "");
    const message = logged && logged !== own ? `${logged}: ${own}` : own;
    const causes = this.causeChain(error).slice(
      0,
      SigilServerErrors.MAX_CAUSE_CHARS,
    );
    const frames = String(error?.stack ?? "").slice(0, 4096 - causes.length);
    return {
      name: error?.name ?? "Error",
      message: message.slice(0, 2000),
      stack: `${frames}${causes}`,
      sourceUrl: sigilScrubUrl(sourceUrl),
      origin: "server" as const,
    };
  }

  /**
   * `error.cause`, level by level, as `\nCaused by: name: message` lines.
   * Stops at `MAX_CAUSES`, at a cause seen before (a cycle), and at
   * anything that is not an object; a non-`Error` cause is printed as text.
   */
  protected causeChain(error: Error | undefined): string {
    let out = "";
    const seen = new Set<unknown>([error]);
    let cause = (error as { cause?: unknown } | undefined)?.cause;
    for (
      let depth = 0;
      depth < SigilServerErrors.MAX_CAUSES && cause != null && !seen.has(cause);
      depth++
    ) {
      seen.add(cause);
      if (typeof cause === "object") {
        const { name, message } = cause as {
          name?: unknown;
          message?: unknown;
        };
        out += `\nCaused by: ${this.text(name) || "Error"}: ${this.text(message)}`;
        cause = (cause as { cause?: unknown }).cause;
      } else {
        out += `\nCaused by: ${this.text(cause)}`;
        break;
      }
    }
    return out;
  }

  /**
   * A primitive as text, and nothing for anything else: a cause's `name`
   * or `message` is a string in practice, and an object there would print
   * as `[object Object]`, which says nothing.
   */
  protected text(value: unknown): string {
    return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
      ? String(value)
      : "";
  }
}

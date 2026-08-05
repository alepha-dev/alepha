import { $env, $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";
import {
  SIGIL_CONFIG_DEFAULTS,
  type SigilConfig,
} from "../shared/schemas/sigilConfig.ts";
import type { SigilEnvelope } from "../shared/schemas/sigilEnvelope.ts";
import { sigilClientAtom } from "../shared/sigilClientAtom.ts";
import {
  allTrackersEnabled,
  type SigilTracker,
} from "../shared/sigilFeatures.ts";
import { sigilFingerprintSource } from "../shared/sigilFingerprint.ts";
import { sigilOptions } from "../shared/sigilOptionsAtom.ts";
import { SIGIL_CONFIG_PATH, SIGIL_INGEST_PATH } from "../shared/sigilPaths.ts";
import { sigilEnv } from "../sigilEnv.ts";

/** How long a batch may sit before it is worth a round trip. */
const FLUSH_WINDOW_MS = 10_000;

/** How long a fetched config is trusted before asking again. */
const CONFIG_TTL_MS = 60_000;

/** Envelope caps, mirroring the schema so a flush never builds a 413. */
const CAPS = { views: 50, errors: 20, vitals: 50 } as const;

/**
 * One error, and how many times it happened since the last flush.
 */
interface AggregatedError {
  name: string;
  message: string;
  stack: string;
  sourceUrl: string;
  origin?: "client" | "server";
  count: number;
}

/**
 * Owns the app's relationship with its sink: what to collect, how
 * much, and when to send it.
 *
 * **Aggregates before sending.** Errors are keyed by fingerprint inside the
 * flush window, so a crash loop leaves one line with a count rather than a
 * thousand identical events — which is the difference between a sink that
 * survives a bad deploy and one that falls over during it.
 *
 * **No timer.** Flushing is decided at enqueue time, from the age of the
 * oldest pending item and from the caps. A `setInterval` would not survive a
 * request on workerd, and an app that only flushes when it is already busy is
 * exactly the app whose last errors before a crash are the ones worth having.
 *
 * **Works with no sink at all.** Without `SIGIL_SINK` / `SIGIL_KEY`
 * nothing leaves the machine: the same aggregation happens, and the result goes
 * to the logger. An app that must not phone home still gets its crash loop
 * collapsed into one warning.
 */
export class SigilSinkProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected env = $env(sigilEnv);

  /** Errors waiting to be sent, keyed by fingerprint source. */
  protected readonly pendingErrors = new Map<string, AggregatedError>();
  protected pendingViews: NonNullable<SigilEnvelope["views"]> = [];
  protected pendingVitals: NonNullable<SigilEnvelope["vitals"]> = [];
  /** Stamps of the batch being built. Last writer wins; they rarely differ. */
  protected pendingStamp: { country?: string; visitor?: string } = {};
  protected oldestPendingAt?: number;

  /** Last config the sink gave us, and when. */
  protected config: SigilConfig = {};
  protected configFetchedAt = 0;
  protected configInFlight?: Promise<void>;

  protected readonly init = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;

      if (!this.hasSink()) {
        this.log.info(
          "No sink configured (SIGIL_SINK / SIGIL_KEY unset) — capturing locally, sending nothing.",
        );
      }

      // Per request: publish the browser-relevant subset so `exportAtoms`
      // serializes it into the page. The key never goes near this.
      this.alepha.events.on("react:server:render:begin", async () => {
        // Fetch the config if this process has never had one.
        //
        // `refreshConfig` is otherwise reached only from `ingest()`, which
        // meant this hook published a config nothing had asked for: a process
        // rendering before it had sent any telemetry set `feedbackUrl:
        // undefined` and hid the feedback button. On a per-request runtime the
        // isolate serving that first page may never be the one that later warms
        // up, so the button could simply never appear.
        //
        // Deliberately here and not at `start`: a warm-up on boot stamps
        // `configFetchedAt` and so eats the TTL window, leaving the app pinned
        // to whatever it got — including the fail-open default — for the next
        // minute, before the rest of the app (a database, a sigil row) is
        // necessarily ready to answer. Guarding on `configFetchedAt` rather
        // than on the config's contents keeps a failed fetch from turning this
        // into a retry loop in front of a dead sink; `ingest()` picks it up on
        // the next TTL window, exactly as before.
        if (!this.configFetchedAt) await this.refreshConfig();

        this.alepha.store.set(sigilClientAtom, {
          enabled: this.enabledTrackers(),
          sampling: this.config.sampling ?? SIGIL_CONFIG_DEFAULTS.sampling,
          excludedPaths:
            this.alepha.store.get(sigilOptions).excludedPaths ?? [],
          feedbackUrl: this.config.feedbackUrl,
        });
      });
    },
  });

  /**
   * Flush what is left on the way out.
   *
   * The batch a process is holding when it stops is the one describing why it
   * stopped.
   */
  protected readonly drain = $hook({
    on: "stop",
    handler: async () => {
      if (this.alepha.isBrowser()) return;
      await this.flush();
    },
  });

  public hasSink(): boolean {
    return !!(this.env.SIGIL_SINK && this.env.SIGIL_KEY);
  }

  public sinkOrigin(): string {
    return (this.env.SIGIL_SINK ?? "").replace(/\/$/, "");
  }

  /**
   * Which trackers are on right now, sink's opinion over the default.
   *
   * Defaults to everything on: before the sink has spoken, and forever if it
   * never does, the app keeps collecting. Silence from the sink is not consent
   * to stop observing.
   */
  public enabledTrackers(): Record<SigilTracker, boolean> {
    return { ...allTrackersEnabled(), ...(this.config.enabled ?? {}) };
  }

  public feedbackUrl(): string | undefined {
    return this.config.feedbackUrl;
  }

  /**
   * Refreshes the config if it has gone stale, and never lets that failure
   * become the app's problem.
   *
   * Fail-open on the last known config: a sink that is down must not silence an
   * app's reporting, and must not make it emit more either. Concurrent callers
   * share one in-flight request — a cold start behind a burst of traffic should
   * not turn into a burst of config fetches.
   */
  public async refreshConfig(): Promise<void> {
    if (!this.hasSink()) return;
    if (this.dateTime.nowMillis() - this.configFetchedAt < CONFIG_TTL_MS)
      return;
    if (this.configInFlight) return await this.configInFlight;

    this.configInFlight = (async () => {
      try {
        this.config = await this.fetchConfig();
        this.configFetchedAt = this.dateTime.nowMillis();
      } catch (error) {
        // Deliberately not fatal, and deliberately not a reset: keeping the
        // previous appetite is the only behaviour that is safe in both
        // directions.
        this.log.warn(
          `Sigil config refresh failed for ${this.sinkOrigin()}; keeping the last known one`,
          error,
        );
        // Back off as if it had succeeded, so a dead sink is asked once a
        // minute rather than on every request.
        this.configFetchedAt = this.dateTime.nowMillis();
      } finally {
        this.configInFlight = undefined;
      }
    })();

    await this.configInFlight;
  }

  /**
   * Takes an envelope into the current batch, and sends it when it is due.
   *
   * Disabled trackers are dropped here rather than at the sink: the point of a
   * kill-switch is to stop the traffic, not to move where it is discarded.
   */
  public async ingest(
    envelope: SigilEnvelope,
    stamp: { country?: string; visitor?: string } = {},
  ): Promise<void> {
    await this.refreshConfig();
    const enabled = this.enabledTrackers();
    const now = this.dateTime.nowMillis();

    if (envelope.views?.length && enabled.views) {
      this.pendingViews.push(...envelope.views);
    }
    if (envelope.vitals?.length && enabled.vitals) {
      this.pendingVitals.push(...envelope.vitals);
    }
    if (envelope.errors?.length && enabled.errors) {
      for (const error of envelope.errors) {
        this.aggregate(error);
      }
    }
    if (stamp.country || stamp.visitor) {
      this.pendingStamp = stamp;
    }

    if (this.oldestPendingAt === undefined && this.hasPending()) {
      this.oldestPendingAt = now;
    }
    if (this.isDue(now)) {
      await this.flush();
    }
  }

  /**
   * Merges one error into the batch under its fingerprint.
   *
   * The first occurrence keeps its sample; later ones only add to the count.
   * Replacing the sample would make the stored stack drift toward the most
   * recent occurrence, which is never the informative one.
   */
  protected aggregate(error: NonNullable<SigilEnvelope["errors"]>[number]) {
    const key = sigilFingerprintSource(error.name, error.stack);
    const existing = this.pendingErrors.get(key);
    if (existing) {
      existing.count += error.count ?? 1;
      return;
    }
    this.pendingErrors.set(key, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      sourceUrl: error.sourceUrl,
      origin: error.origin,
      count: error.count ?? 1,
    });
  }

  /**
   * Flushes at the end of a request, on runtimes that do not survive one.
   *
   * The batching below waits ten seconds or a cap, and decides only inside
   * `ingest()` — no timers, because a timer in a serverless isolate is a
   * promise nobody kept. That is right for a long-running server, where the
   * next request arrives and carries the decision forward.
   *
   * On Cloudflare Workers the isolate is torn down between requests. A batch
   * that has not reached a cap and is younger than the window is simply gone:
   * not delayed, lost. The app that most needs this — Lore — is exactly there.
   *
   * So on a serverless runtime the batch goes at the end of every request.
   * That costs the aggregation across requests, which is the point of batching,
   * but a fingerprint is still aggregated WITHIN a request — the crash loop
   * inside one handler, which is the volume case. Chatty and correct beats
   * quiet and empty.
   */
  protected readonly onResponse = $hook({
    on: "server:onResponse",
    handler: async () => {
      if (!this.alepha.isServerless()) return;
      if (!this.hasPending()) return;
      await this.flush();
    },
  });

  protected hasPending(): boolean {
    return (
      this.pendingErrors.size > 0 ||
      this.pendingViews.length > 0 ||
      this.pendingVitals.length > 0
    );
  }

  /**
   * Whether the batch should go now: because it has waited long enough, or
   * because holding more would build a payload the sink refuses.
   */
  protected isDue(now: number): boolean {
    if (!this.hasPending()) return false;
    if (this.pendingErrors.size >= CAPS.errors) return true;
    if (this.pendingViews.length >= CAPS.views) return true;
    if (this.pendingVitals.length >= CAPS.vitals) return true;
    return now - (this.oldestPendingAt ?? now) >= FLUSH_WINDOW_MS;
  }

  /**
   * Sends the batch, or logs it when there is no sink.
   *
   * The batch is cleared **before** the request: a sink that is down must not
   * make the app accumulate until it runs out of memory. Losing a batch is a
   * gap in a chart; holding every batch is an outage.
   */
  public async flush(): Promise<void> {
    if (!this.hasPending()) return;

    const envelope: SigilEnvelope = {
      ...(this.pendingViews.length
        ? { views: this.pendingViews.slice(0, CAPS.views) }
        : {}),
      ...(this.pendingVitals.length
        ? { vitals: this.pendingVitals.slice(0, CAPS.vitals) }
        : {}),
      ...(this.pendingErrors.size
        ? { errors: [...this.pendingErrors.values()].slice(0, CAPS.errors) }
        : {}),
    };
    const stamp = this.pendingStamp;
    this.reset();

    if (!this.hasSink()) {
      this.report(envelope);
      return;
    }

    try {
      await this.deliver({ ...envelope, ...stamp });
    } catch (error) {
      // A sink that refuses or is unreachable must never surface as an app
      // error: the app is working, its observer is not.
      this.log.warn(`Sigil flush failed for ${this.sinkOrigin()}`, error);
    }
  }

  /**
   * Asks the sink how much to send. The only GET this provider makes.
   *
   * Its own method, alongside {@link deliver}, because an app can BE its own
   * sink — Lore reports to itself — and on workerd a Worker cannot fetch its
   * own hostname: the subrequest fails, and since both callers are fail-open
   * it fails silently, leaving an app that looks enrolled and reports nothing.
   * A host in that position substitutes this provider and answers both in
   * process. Everything else — aggregation, the flush window, the caps, the
   * fail-open handling around these two calls — is shared, so the in-process
   * path cannot drift into behaving differently from the networked one.
   *
   * Throws on failure; the caller decides what that means.
   */
  protected async fetchConfig(): Promise<SigilConfig> {
    const res = await this.http.fetch(
      `${this.sinkOrigin()}${SIGIL_CONFIG_PATH}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${this.env.SIGIL_KEY}` },
      },
    );
    return (res.data ?? {}) as SigilConfig;
  }

  /**
   * Hands one batch to the sink. The only POST this provider makes.
   *
   * @see {@link fetchConfig} for why it is separable.
   */
  protected async deliver(
    payload: SigilEnvelope & { country?: string; visitor?: string },
  ): Promise<void> {
    await this.http.fetch(`${this.sinkOrigin()}${SIGIL_INGEST_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.env.SIGIL_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  }

  /**
   * What "no sink" looks like: the errors, aggregated, in the app's own log.
   *
   * Only errors. Views and vitals with nowhere to go are noise in a log file;
   * an error is the one thing an operator reading `journalctl` is looking for.
   */
  protected report(envelope: SigilEnvelope): void {
    for (const error of envelope.errors ?? []) {
      this.log.warn(
        `[sigil] ${error.name}: ${error.message}${
          (error.count ?? 1) > 1 ? ` (×${error.count})` : ""
        }`,
        { sourceUrl: error.sourceUrl, origin: error.origin },
      );
    }
  }

  protected reset(): void {
    this.pendingErrors.clear();
    this.pendingViews = [];
    this.pendingVitals = [];
    this.pendingStamp = {};
    this.oldestPendingAt = undefined;
  }
}

import { $env, $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";
import { pulseEnv } from "../pulseEnv.ts";
import { pulseClientAtom } from "../shared/pulseClientAtom.ts";
import {
  allTrackersEnabled,
  type PulseTracker,
} from "../shared/pulseFeatures.ts";
import { pulseFingerprintSource } from "../shared/pulseFingerprint.ts";
import { pulseOptions } from "../shared/pulseOptionsAtom.ts";
import {
  type PulseConfig,
  TELEMETRY_CONFIG_DEFAULTS,
} from "../shared/schemas/pulseConfig.ts";
import type { PulseEnvelope } from "../shared/schemas/pulseEnvelope.ts";

/** How long a batch may sit before it is worth a round trip. */
const FLUSH_WINDOW_MS = 10_000;

/** How long a fetched config is trusted before asking again. */
const CONFIG_TTL_MS = 60_000;

/** Envelope caps, mirroring the schema so a flush never builds a 413. */
const CAPS = { views: 50, errors: 20, vitals: 50, metrics: 60 } as const;

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
 * Owns the app's relationship with its telemetry sink: what to collect, how
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
 * **Works with no sink at all.** Without `PULSE_SINK` / `PULSE_KEY`
 * nothing leaves the machine: the same aggregation happens, and the result goes
 * to the logger. An app that must not phone home still gets its crash loop
 * collapsed into one warning.
 */
export class PulseSinkProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected env = $env(pulseEnv);

  /** Errors waiting to be sent, keyed by fingerprint source. */
  protected readonly pendingErrors = new Map<string, AggregatedError>();
  protected pendingViews: NonNullable<PulseEnvelope["views"]> = [];
  protected pendingVitals: NonNullable<PulseEnvelope["vitals"]> = [];
  protected pendingMetrics: NonNullable<PulseEnvelope["metrics"]> = [];
  protected pendingHeartbeat?: PulseEnvelope["heartbeat"];
  /** Stamps of the batch being built. Last writer wins; they rarely differ. */
  protected pendingStamp: { country?: string; visitor?: string } = {};
  protected oldestPendingAt?: number;

  /** Last config the sink gave us, and when. */
  protected config: PulseConfig = {};
  protected configFetchedAt = 0;
  protected configInFlight?: Promise<void>;

  protected readonly init = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;

      if (!this.hasSink()) {
        this.log.info(
          "Telemetry has no sink (PULSE_SINK / PULSE_KEY unset) — capturing locally, sending nothing.",
        );
      }

      // Per request: publish the browser-relevant subset so `exportAtoms`
      // serializes it into the page. The key never goes near this.
      this.alepha.events.on("react:server:render:begin", () => {
        this.alepha.store.set(pulseClientAtom, {
          enabled: this.enabledTrackers(),
          sampling: this.config.sampling ?? TELEMETRY_CONFIG_DEFAULTS.sampling,
          excludedPaths:
            this.alepha.store.get(pulseOptions).excludedPaths ?? [],
          petitionUrl: this.config.petitionUrl,
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
    return !!(this.env.PULSE_SINK && this.env.PULSE_KEY);
  }

  public sinkOrigin(): string {
    return (this.env.PULSE_SINK ?? "").replace(/\/$/, "");
  }

  /**
   * Which trackers are on right now, sink's opinion over the default.
   *
   * Defaults to everything on: before the sink has spoken, and forever if it
   * never does, the app keeps collecting. Silence from the sink is not consent
   * to stop observing.
   */
  public enabledTrackers(): Record<PulseTracker, boolean> {
    return { ...allTrackersEnabled(), ...(this.config.enabled ?? {}) };
  }

  public metricsIntervalSec(): number {
    return (
      this.config.metricsIntervalSec ??
      TELEMETRY_CONFIG_DEFAULTS.metricsIntervalSec
    );
  }

  public petitionUrl(): string | undefined {
    return this.config.petitionUrl;
  }

  /**
   * Refreshes the config if it has gone stale, and never lets that failure
   * become the app's problem.
   *
   * Fail-open on the last known config: a sink that is down must not silence an
   * app's telemetry, and must not make it emit more either. Concurrent callers
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
        const res = await this.http.fetch(
          `${this.sinkOrigin()}/api/ingest/config`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${this.env.PULSE_KEY}` },
          },
        );
        this.config = (res.data ?? {}) as PulseConfig;
        this.configFetchedAt = this.dateTime.nowMillis();
      } catch (error) {
        // Deliberately not fatal, and deliberately not a reset: keeping the
        // previous appetite is the only behaviour that is safe in both
        // directions.
        this.log.warn(
          `Telemetry config refresh failed for ${this.sinkOrigin()}; keeping the last known one`,
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
    envelope: PulseEnvelope,
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
    if (envelope.metrics?.length && enabled.metrics) {
      this.pendingMetrics.push(...envelope.metrics);
    }
    if (envelope.heartbeat && enabled.metrics) {
      this.pendingHeartbeat = envelope.heartbeat;
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
  protected aggregate(error: NonNullable<PulseEnvelope["errors"]>[number]) {
    const key = pulseFingerprintSource(error.name, error.stack);
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

  protected hasPending(): boolean {
    return (
      this.pendingErrors.size > 0 ||
      this.pendingViews.length > 0 ||
      this.pendingVitals.length > 0 ||
      this.pendingMetrics.length > 0 ||
      this.pendingHeartbeat !== undefined
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
    if (this.pendingMetrics.length >= CAPS.metrics) return true;
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

    const envelope: PulseEnvelope = {
      ...(this.pendingViews.length
        ? { views: this.pendingViews.slice(0, CAPS.views) }
        : {}),
      ...(this.pendingVitals.length
        ? { vitals: this.pendingVitals.slice(0, CAPS.vitals) }
        : {}),
      ...(this.pendingMetrics.length
        ? { metrics: this.pendingMetrics.slice(0, CAPS.metrics) }
        : {}),
      ...(this.pendingHeartbeat ? { heartbeat: this.pendingHeartbeat } : {}),
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
      await this.http.fetch(`${this.sinkOrigin()}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.env.PULSE_KEY}`,
        },
        body: JSON.stringify({ ...envelope, ...stamp }),
      });
    } catch (error) {
      // A sink that refuses or is unreachable must never surface as an app
      // error: the app is working, its observer is not.
      this.log.warn(`Telemetry flush failed for ${this.sinkOrigin()}`, error);
    }
  }

  /**
   * What "no sink" looks like: the errors, aggregated, in the app's own log.
   *
   * Only errors. Views and vitals with nowhere to go are noise in a log file;
   * an error is the one thing an operator reading `journalctl` is looking for.
   */
  protected report(envelope: PulseEnvelope): void {
    for (const error of envelope.errors ?? []) {
      this.log.warn(
        `[telemetry] ${error.name}: ${error.message}${
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
    this.pendingMetrics = [];
    this.pendingHeartbeat = undefined;
    this.pendingStamp = {};
    this.oldestPendingAt = undefined;
  }
}

import { $env, $hook, $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";

import type { SigilConfig } from "../shared/schemas/sigilConfig.ts";
import type { SigilEnvelope } from "../shared/schemas/sigilEnvelope.ts";
import {
  type SigilClientConfig,
  sigilClientAtom,
} from "../shared/sigilClientAtom.ts";
import type { SigilTracker } from "../shared/sigilFeatures.ts";
import { sigilFingerprintSource } from "../shared/sigilFingerprint.ts";
import { sigilKeyProject } from "../shared/sigilKey.ts";
import { SIGIL_INGEST_PATH } from "../shared/sigilPaths.ts";
import { SIGIL_DEFAULT_SINK, sigilEnv } from "../sigilEnv.ts";

/** How long a batch may sit before it is worth a round trip. */
const FLUSH_WINDOW_MS = 10_000;

/** Envelope caps, mirroring the schema so a flush never builds a 413. */
const CAPS = { views: 50, errors: 20, vitals: 50, engagements: 50 } as const;

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
 * **Works with no sink at all.** The origin carries a default, but a key does
 * not: without `SIGIL_KEY` nothing leaves the machine. The same aggregation
 * happens
 * and the result goes to the logger, so an app that must not phone home still
 * gets its crash loop collapsed into one warning — and gets it by doing
 * nothing, which is the only default worth having here.
 *
 * **What to collect is read, not asked for.** This provider used to fetch its
 * config from the sink and cache it for a minute. See {@link sigilConfig} for
 * why that had to go; the short version is that the cache could not survive a
 * serverless isolate and the fetch could not survive a prerender, and it was
 * awaited in front of the first byte of every cold page.
 */
export class SigilSinkProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected readonly background = $inject(BackgroundTaskProvider);
  protected env = $env(sigilEnv);

  /** Errors waiting to be sent, keyed by fingerprint source. */
  protected readonly pendingErrors = new Map<string, AggregatedError>();
  protected pendingViews: NonNullable<SigilEnvelope["views"]> = [];
  protected pendingVitals: NonNullable<SigilEnvelope["vitals"]> = [];
  protected pendingEngagements: NonNullable<SigilEnvelope["engagements"]> = [];
  /** Stamps of the batch being built. Last writer wins; they rarely differ. */
  protected pendingStamp: {
    country?: string;
    visitor?: string;
    device?: string;
  } = {};
  protected oldestPendingAt?: number;

  /**
   * What this app collects, straight from `SIGIL_CONFIG`.
   *
   * `undefined` when the variable is unset, which is the ordinary case rather
   * than a broken one: every field is a switch with the answer an unconfigured
   * app wants, so an absent config reads as "collect everything". Whether
   * anything is SENT is a separate question, and only `SIGIL_KEY` answers it.
   */
  public get config(): SigilConfig | undefined {
    return this.env.SIGIL_CONFIG;
  }

  /**
   * The project this app reports into, read out of its own key.
   *
   * `undefined` for a key minted before the slug moved into the token, and for
   * no key at all. Both mean the same thing here: no feedback URL can be built.
   * Neither stops a single event from being reported, because the sink resolves
   * the project from the credential and never from anything the app says.
   */
  public project(): string | undefined {
    return sigilKeyProject(this.env.SIGIL_KEY);
  }

  protected readonly init = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;

      // One variable decides this: the key. Everything else has a default, so
      // there is no half-configured state left to warn about - an app either
      // was given a credential or was not.
      if (!this.hasSink()) {
        this.log.info(
          "Sigil not configured - capturing locally, sending nothing.",
        );
        return;
      }

      // The sink carries a default, and a default nobody can see is how an app
      // ends up reporting somewhere its operator never chose. Naming the
      // resolved origin AND where it came from is the whole mitigation: a
      // self-hoster who forgot the variable reads one line instead of debugging
      // why their own Lore stayed empty while the public instance answered 401
      // to a key it has never heard of.
      const project = this.project();
      this.log.info(
        `Sigil sink: ${this.sinkOrigin()} (${
          this.env.SIGIL_SINK === SIGIL_DEFAULT_SINK
            ? "default - set SIGIL_SINK to self-host"
            : "from SIGIL_SINK"
        }), project ${project ?? "unnamed"}`,
      );

      // Worth a warning rather than silence, because everything else keeps
      // working: views, vitals and errors all arrive, so the only symptom is a
      // feedback button that never appears, which reads as a UI bug rather than
      // a stale credential.
      if (!project) {
        this.log.warn(
          "SIGIL_KEY names no project - reporting normally, but there is no " +
            "feedback link to offer. Rotate the key on the sink to get one " +
            "shaped sg_<project>_<secret>.",
        );
      }
    },
  });

  /**
   * Publish the browser-relevant subset, stamped with now.
   *
   * On `react:server:render:begin` so `exportAtoms` serializes it into the
   * page, and stamped there rather than at `start` because the stamp has to
   * describe the render: a prerender writes a build-time stamp into a file that
   * ships for weeks, and that is precisely what the browser needs to be able to
   * notice. See {@link sigilClientAtom}.
   *
   * This hook used to `await` a fetch to the sink before it could publish
   * anything, which put a round trip in front of the first byte of every cold
   * page. Reading env costs nothing, so there is no longer a reason for it to
   * be async.
   */
  protected readonly publish = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;

      this.alepha.events.on("react:server:render:begin", () => {
        this.alepha.store.set(sigilClientAtom, this.clientConfig());
      });
    },
  });

  /**
   * The subset of the config the browser is allowed to see, stamped.
   *
   * Also what the ingest response hands back, so a page whose stamp has gone
   * stale gets the current answer from the call it was going to make anyway.
   */
  public clientConfig(): SigilClientConfig {
    return {
      enabled: this.enabledTrackers(),
      feedbackButtonExcludedPaths:
        this.config?.feedbackButtonExcludedPaths ?? [],
      feedbackUrl: this.feedbackUrl(),
      feedbackButton: this.config?.feedbackButton,
      configAt: this.dateTime.nowMillis(),
    };
  }

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

  /**
   * Whether anything may leave this machine.
   *
   * The key alone, now that the sink has a default and the project rides in the
   * key. This used to require a config as well, which made a variable that
   * carries nothing but switches load-bearing for whether reporting happened at
   * all - an app with a perfectly good credential stayed silent because its
   * JSON was missing.
   */
  public hasSink(): boolean {
    return !!this.env.SIGIL_KEY;
  }

  /**
   * The origin to report to, normalized.
   *
   * A missing scheme is filled in rather than rejected, because the value is
   * pasted by a human from a browser's address bar as often as it is typed. A
   * bare `lore.example.com` is concatenated into a fetch URL and into the
   * feedback link, where it silently becomes a RELATIVE path: the flush hits
   * the app's own origin and 404s into the fail-open warning, and the feedback
   * link points at a page of the app itself. Both failures look like anything
   * other than a missing `https://`.
   */
  public sinkOrigin(): string {
    const raw = (this.env.SIGIL_SINK || SIGIL_DEFAULT_SINK).trim();
    const origin = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    return origin.replace(/\/+$/, "");
  }

  /**
   * Which trackers are on, mapped from the config's names.
   *
   * The config speaks the sink's language — `analytics`, `blights` — while the
   * envelope and the browser gate speak in terms of what is collected:
   * `views`, `errors`. Translating in one place is what lets either vocabulary
   * change without the other following.
   *
   * Everything on when there is no config, which is the ordinary shape of an
   * enrolled app: the variable exists to turn things OFF. An app that never
   * sets it collects the lot, and an app with no key collects the lot into its
   * own logger, because inert should still mean "captures locally" rather than
   * "captures nothing".
   */
  public enabledTrackers(): Record<SigilTracker, boolean> {
    const config = this.config;
    return {
      views: config?.analytics ?? true,
      errors: config?.blights ?? true,
      vitals: config?.vitals ?? true,
    };
  }

  /**
   * Where a reader goes to file feedback, derived rather than fetched.
   *
   * The sink used to hand this back, because the slug lived only there. That
   * round trip is what the slug-in-the-key removes: an app can address its own
   * project the moment it has a credential, with nothing to ask and nothing to
   * wait for before the first byte of a cold page.
   *
   * `undefined` in three cases, and only the first is a decision: the operator
   * turned feedback off, there is no key, or the key predates the format and
   * names no project. All three render the same nothing.
   */
  public feedbackUrl(): string | undefined {
    if (this.config?.feedback === false || !this.hasSink()) {
      return undefined;
    }
    const project = this.project();
    return project ? `${this.sinkOrigin()}/${project}/request` : undefined;
  }

  /**
   * Takes an envelope into the current batch, and sends it when it is due.
   *
   * Disabled trackers are dropped here rather than at the sink: the point of a
   * kill-switch is to stop the traffic, not to move where it is discarded.
   */
  public async ingest(
    envelope: SigilEnvelope,
    stamp: { country?: string; visitor?: string; device?: string } = {},
  ): Promise<void> {
    const enabled = this.enabledTrackers();
    const now = this.dateTime.nowMillis();

    if (envelope.views?.length && enabled.views) {
      this.pendingViews.push(...envelope.views);
    }
    if (envelope.vitals?.length && enabled.vitals) {
      this.pendingVitals.push(...envelope.vitals);
    }
    // Behind the views gate, not one of its own: engagement is a fact about a
    // view, and an `engaged` total that outlived the `count` it divides into
    // would be worse than not collecting it.
    if (envelope.engagements?.length && enabled.views) {
      this.pendingEngagements.push(...envelope.engagements);
    }
    if (envelope.errors?.length && enabled.errors) {
      for (const error of envelope.errors) {
        this.aggregate(error);
      }
    }
    if (stamp.country || stamp.visitor || stamp.device) {
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
    handler: () => {
      if (!this.alepha.isServerless()) return;
      if (!this.hasPending()) return;

      // Deferred, not awaited. The flush is a request to the sink, and awaiting
      // it here put that round trip inside the browser's own call — measured at
      // ~1.1 s cold against a live worker, for a response the visitor is
      // waiting on. Two things paid for it: the `pagehide` batch, which carries
      // the metrics finalised on the way out and is the one a browser tearing
      // down a document is least likely to keep alive for a second; and the
      // feedback button, which since the config started riding back on this
      // response cannot render until the sink has answered something it was
      // never asked.
      //
      // `defer` is not fire-and-forget on this runtime. The workerd variant
      // wraps the task in `executionCtx.waitUntil`, so the isolate is kept
      // alive until the flush settles rather than frozen at the response —
      // which is the whole reason this hook exists here instead of a timer.
      this.background.defer(() => this.flush());
    },
  });

  protected hasPending(): boolean {
    return (
      this.pendingErrors.size > 0 ||
      this.pendingViews.length > 0 ||
      this.pendingVitals.length > 0 ||
      this.pendingEngagements.length > 0
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
    if (this.pendingEngagements.length >= CAPS.engagements) return true;
    return now - (this.oldestPendingAt ?? now) >= FLUSH_WINDOW_MS;
  }

  /**
   * Sends one capped batch, or logs it when there is no sink.
   *
   * The batch is cleared **before** the request: a sink that is down must not
   * make the app accumulate until it runs out of memory. Losing a batch is a
   * gap in a chart; holding every batch is an outage.
   *
   * **What is over the cap is carried forward, not dropped.** This used to
   * `slice` to the cap and then `reset()`, so anything past it was discarded
   * with no log and no counter — `pendingViews` at 49 taking a full 50-view
   * envelope sent 50 and lost 49. That is reachable on Node, where a batch
   * spans requests: `ingest()` pushes a whole envelope at once and `isDue()`
   * only fires afterwards, so pending jumps past the cap in a single call.
   * `sigilEnvelope` argues the case against exactly this — silently dropping
   * the tail of a batch makes a sink look healthy while it loses data — and
   * this method was the one place that did it.
   *
   * `oldestPendingAt` is deliberately left alone when a remainder survives: it
   * is older than what just went out, so it should be due immediately rather
   * than starting a fresh window.
   */
  public async flush(): Promise<void> {
    if (!this.hasPending()) return;

    const views = this.pendingViews.splice(0, CAPS.views);
    const vitals = this.pendingVitals.splice(0, CAPS.vitals);
    const engagements = this.pendingEngagements.splice(0, CAPS.engagements);
    // Entries, so the surviving ones are deleted by the key they were stored
    // under rather than by a recomputed fingerprint.
    const errorEntries = [...this.pendingErrors.entries()].slice(
      0,
      CAPS.errors,
    );
    for (const [key] of errorEntries) this.pendingErrors.delete(key);

    const envelope: SigilEnvelope = {
      ...(views.length ? { views } : {}),
      ...(vitals.length ? { vitals } : {}),
      ...(engagements.length ? { engagements } : {}),
      ...(errorEntries.length
        ? { errors: errorEntries.map(([, error]) => error) }
        : {}),
    };
    const stamp = this.pendingStamp;
    // The stamp belongs to the remainder too — same visitor, same batch.
    if (!this.hasPending()) this.reset();

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
   * Hands one batch to the sink. The only request this provider makes.
   *
   * Its own method because an app can BE its own sink — Lore reports to itself
   * — and on workerd a Worker cannot fetch its own hostname: the subrequest
   * fails, and since the caller is fail-open it fails silently, leaving an app
   * that looks enrolled and reports nothing. A host in that position
   * substitutes this provider and answers in process. Everything else —
   * aggregation, the flush window, the caps, the fail-open handling around this
   * call — is shared, so the in-process path cannot drift into behaving
   * differently from the networked one.
   *
   * It used to have a sibling, `fetchConfig`, for the GET that asked the sink
   * what to collect. There is no such GET any more.
   */
  protected async deliver(
    payload: SigilEnvelope & {
      country?: string;
      visitor?: string;
      device?: string;
    },
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
    this.pendingEngagements = [];
    this.pendingStamp = {};
    this.oldestPendingAt = undefined;
  }
}

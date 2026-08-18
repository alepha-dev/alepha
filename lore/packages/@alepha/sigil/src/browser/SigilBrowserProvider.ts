import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  SIGIL_FIRST_INGEST_MAX_MS,
  sigilClientAtom,
  sigilConfigIsFresh,
} from "../shared/sigilClientAtom.ts";
import type { SigilTracker } from "../shared/sigilFeatures.ts";
import { sigilScrubUrl } from "../shared/sigilScrubUrl.ts";
import { SigilQueue } from "./SigilQueue.ts";
import { SigilVitals } from "./SigilVitals.ts";

/**
 * Browser bootstrap: subscribes to framework hooks, batches what it observes, and
 * posts the envelope to the same-origin `/api/sigil/ingest` proxy. No
 * credential lives here. Active in production + browser only.
 *
 * Each tracker is gated by {@link sigilClientAtom} — the SSR-hydrated view
 * of what the sink currently wants. Gates are read lazily, per event, because
 * the atom is hydrated on `ready`, after this `start` hook has attached its
 * listeners; reading them once here would freeze the pre-hydration defaults.
 *
 * A page served from a file or a cache carries a config older than the visit.
 * `configAt` on the atom is what says so, and the first ingest call brings back
 * the current one — see the `react:browser:render` handler.
 */
export class SigilBrowserProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected queue?: SigilQueue;

  /**
   * Whether the hydration render has already been counted as a pageview.
   *
   * Both `react:transition:end` and `react:browser:render` fire for the initial
   * render — `ReactBrowserProvider`'s `ready` hook awaits `render()`, which
   * emits the transition, and then emits the browser render itself, about two
   * milliseconds later. Listening to both counted every visit's landing page
   * twice, which is the one number a docs site is read for.
   *
   * The `browser:render` listener is the keeper, because it fires after atom
   * hydration and so sees the sink's real feature flags rather than the
   * pre-hydration defaults. So the transition listener stands down until this
   * flag is set, and owns every navigation after it.
   */
  protected initialRenderCounted = false;

  /**
   * Ceiling on the wait for LCP before the first ingest goes out. A field
   * rather than the constant inlined, so a test can shorten it.
   */
  protected firstIngestDelayMs = SIGIL_FIRST_INGEST_MAX_MS;

  /** Whether the render hook has queued the pageview and started the wait. */
  protected firstIngestArmed = false;

  /** Whether the first ingest has gone out. It happens once per page load. */
  protected firstIngestSent = false;

  /** Whether LCP has arrived, which may be before the render hook runs. */
  protected lcpSeen = false;

  protected firstIngestTimer?: ReturnType<typeof setTimeout>;

  protected readonly start = $hook({
    on: "start",
    handler: () => {
      if (typeof window === "undefined") return;
      if (!this.alepha.isProduction()) return;

      // Every response carries the current config, so the app's own server —
      // which reads it from env on each request — is what keeps a long-lived
      // page current. No second endpoint, and no call that exists only to ask.
      const send = async (env: object): Promise<void> => {
        try {
          const res = await fetch("/api/sigil/ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(env),
            keepalive: true,
            credentials: "same-origin",
          } as any);
          const body = await res.json();
          if (body?.config) {
            this.alepha.store.set(sigilClientAtom, body.config);
            // Applies to what is already waiting, not just to what comes next.
            // The trackers gated at enqueue used the config this page was
            // served with, which on anything served from a file or a cache is
            // older than the visit.
            this.queue?.dropDisabled(body.config.enabled ?? {});
          }
        } catch {
          // The app is working; its observer is not. Never the app's problem.
        }
      };

      this.queue = new SigilQueue(send as any);

      (this.alepha.events as any).on("react:transition:end", (ev: any) => {
        // The first one is the hydration render, and `react:browser:render`
        // below already counts that. See {@link initialRenderCounted}.
        if (!this.initialRenderCounted) return;
        if (!this.wants("views")) return;
        this.queue!.addView(
          ev.state?.url?.pathname ?? (location as any).pathname,
          this.dateTime.nowMillis(),
        );
      });

      (this.alepha.events as any).on("react:action:error", (ev: any) => {
        if (!this.wants("errors")) return;
        this.queue!.addError(this.toError(ev.error, (location as any).href));
      });

      (window as any).addEventListener("error", (e: any) => {
        if (!this.wants("errors")) return;
        this.queue!.addError(
          this.toError(e.error ?? e, (location as any).href),
        );
      });

      (window as any).addEventListener("unhandledrejection", (e: any) => {
        if (!this.wants("errors")) return;
        this.queue!.addError(this.toError(e.reason, (location as any).href));
      });

      const vitals = new SigilVitals(
        (m) => {
          if (!this.wants("vitals")) return;
          this.queue!.addVital({
            path: (location as any).pathname,
            metric: m.metric,
            value: m.value,
            ts: this.dateTime.nowMillis(),
          });
        },
        () => this.onLcpArrived(),
      );
      vitals.observe();

      (window as any).addEventListener("pagehide", () => {
        void this.queue!.flush();
      });

      (document as any).addEventListener("visibilitychange", () => {
        if ((document as any).visibilityState === "hidden") {
          void this.queue!.flush();
        }
      });

      // The initial pageview is deferred to `react:browser:render` (fires once,
      // after atom hydration) so it respects the hydrated feature flags instead
      // of the pre-hydration default.
      (this.alepha.events as any).on("react:browser:render", () => {
        this.initialRenderCounted = true;
        if (this.wants("views")) {
          this.queue!.addView(
            (location as any).pathname,
            this.dateTime.nowMillis(),
          );
        }

        // The page was served with a config older than this visit — it came
        // from a prerendered file, an edge cache or a restored document. It has
        // to ask, because until the answer arrives the feedback button cannot
        // know whether to render.
        //
        // Not right now, though. This hook runs while the main thread is still
        // busy with the render it just finished, and a request fired here
        // carries one pageview and nothing else: TTFB and FCP land a beat
        // later and used to leave in a second request of their own. Waiting
        // for the page to settle makes it one request carrying both.
        if (
          !sigilConfigIsFresh(
            this.alepha.store.get(sigilClientAtom),
            this.dateTime.nowMillis(),
          )
        ) {
          this.armFirstIngest();
        }
      });
    },
  });

  /**
   * Starts the wait for the first ingest: LCP, or {@link firstIngestDelayMs},
   * whichever comes first.
   *
   * Arming is what the render hook contributes, and it matters that the wait
   * starts here rather than at `start`: the pageview is queued by that hook, so
   * an ingest sent before it would carry an empty envelope and leave the view
   * for a later request — the second request this exists to remove. LCP that
   * already arrived is therefore honoured *now*, not earlier.
   */
  protected armFirstIngest() {
    if (this.firstIngestArmed) return;
    this.firstIngestArmed = true;

    if (this.lcpSeen) {
      this.sendFirstIngest();
      return;
    }

    this.firstIngestTimer = setTimeout(
      () => this.sendFirstIngest(),
      this.firstIngestDelayMs,
    );
  }

  /**
   * The page has painted its main content. Sends the first ingest if the
   * render hook has already queued the view, and otherwise is remembered for
   * when it does.
   */
  protected onLcpArrived() {
    this.lcpSeen = true;
    if (this.firstIngestArmed) {
      this.sendFirstIngest();
    }
  }

  /**
   * Sends everything collected so far, once.
   *
   * Forced, so it still happens when every tracker is off and the queue is
   * therefore empty. That case is the one that matters most: it is the only way
   * such a page ever learns it was switched back on.
   */
  protected sendFirstIngest() {
    if (this.firstIngestSent) return;
    this.firstIngestSent = true;

    if (this.firstIngestTimer) {
      clearTimeout(this.firstIngestTimer);
      this.firstIngestTimer = undefined;
    }

    void this.queue?.flush({ force: true });
  }

  /**
   * Returns the list of pending view paths in the queue.
   * Useful for testing and debugging.
   */
  public debugPendingViews(): string[] {
    return this.queue?.pendingViews() ?? [];
  }

  /**
   * Whether this event should be collected.
   *
   * Read live, per event, rather than resolved once: the atom is replaced when
   * an ingest response brings a newer config, and the whole point of a
   * kill-switch is that events after it stop.
   *
   * Errors are never gated away by a stale config on purpose — see the
   * `blights` field. There is no sampling here any more: the appetite is a
   * declared setting rather than something the sink dictates per page, so an
   * app that wants less says so once.
   */
  protected wants(tracker: SigilTracker): boolean {
    return this.alepha.store.get(sigilClientAtom).enabled[tracker] !== false;
  }

  /**
   * Normalises any thrown value into the error shape expected by the ingest
   * envelope. Truncates message and stack to safe lengths.
   *
   * `sourceUrl` is scrubbed here rather than at the sink so the query string
   * never leaves the browser — see {@link sigilScrubUrl} for what that field
   * was carrying. Callers pass `location.href`; what goes in the envelope is
   * the origin and path.
   */
  protected toError(err: any, sourceUrl: string) {
    return {
      name: err?.name ?? "Error",
      message: String(err?.message ?? err ?? "").slice(0, 2000),
      stack: String(err?.stack ?? "").slice(0, 4096),
      sourceUrl: sigilScrubUrl(sourceUrl),
    };
  }
}

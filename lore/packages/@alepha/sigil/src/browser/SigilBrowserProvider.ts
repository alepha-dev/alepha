import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { sigilCampaign } from "../shared/sigilCampaign.ts";
import {
  SIGIL_FIRST_INGEST_MAX_MS,
  sigilClientAtom,
  sigilConfigIsFresh,
} from "../shared/sigilClientAtom.ts";
import type { SigilTracker } from "../shared/sigilFeatures.ts";
import { sigilReferrerHost } from "../shared/sigilReferrerHost.ts";
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

  /**
   * Which of the two waits is running.
   *
   * A stale-config page waits for LCP, because what it needs is the answer and
   * it needs it before it can render its feedback button. A fresh one waits for
   * the engagement verdict, because it needs nothing and may as well leave once
   * there is nothing left to say. LCP arriving is only a release signal for the
   * first of them.
   */
  protected firstIngestWaitsForLcp = false;

  /** Whether the first ingest has gone out. It happens once per page load. */
  protected firstIngestSent = false;

  /** Whether LCP has arrived, which may be before the render hook runs. */
  protected lcpSeen = false;

  protected firstIngestTimer?: ReturnType<typeof setTimeout>;

  /**
   * The path engagement is currently being measured for, and whether its
   * verdict is in. One pair rather than a set: only one path is on screen at a
   * time, and a `Set` of every path ever visited would keep a long-lived tab's
   * memory growing for no gain.
   *
   * "Settled" rather than "reported" because the two came apart: the verdict is
   * reached whether or not a row is recorded for it, and a page with the views
   * tracker off records none. The opening envelope waits on the verdict, so a
   * flag that only flipped when a row was written would leave such a page
   * holding forever.
   */
  protected engagementPath?: string;
  protected engagementSettled = false;
  protected dwellTimer?: ReturnType<typeof setTimeout>;

  /**
   * How long a visitor has to stay before dwelling alone counts as engagement.
   *
   * Ten seconds is chosen against what it has to separate: a scraper fetching
   * a page and moving on, versus a person reading a paragraph of it. A field
   * rather than a constant so a test does not have to wait it out.
   */
  protected dwellMs = 10_000;

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
        const path = ev.state?.url?.pathname ?? (location as any).pathname;
        // A new path is a new thing to have engaged with, so the flag resets
        // and the dwell timer restarts. Without the reset, a visitor who
        // scrolled the landing page would be counted as engaged with every
        // page they went on to skim.
        this.resetEngagement(path);
        this.queue!.addView(path, this.dateTime.nowMillis());
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

      this.observeEngagement();

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

        // Nothing leaves until this load's envelope is complete - see
        // `SigilQueue.hold`. Held before the view below is queued, so the
        // debounce is never armed in the first place.
        //
        // Guarded on the same flag as the wait it belongs to. This hook is
        // meant to fire once per load, but a second one after the release
        // would re-hold a queue whose only release point has already been
        // spent, and the page would then report nothing until `pagehide`.
        if (!this.firstIngestArmed) this.queue!.hold();

        this.resetEngagement((location as any).pathname);
        if (this.wants("views")) {
          // The referrer rides on this view and no other. `document.referrer`
          // describes how the *document* was loaded, so it keeps its value
          // across every client-side navigation that follows — attaching it to
          // the `transition:end` views above would report one arrival from
          // Hacker News as however many pages that visitor went on to read.
          this.queue!.addView(
            (location as any).pathname,
            this.dateTime.nowMillis(),
            {
              referrer: sigilReferrerHost(
                (document as any).referrer,
                (location as any).origin,
              ),
              campaign: sigilCampaign((location as any).search ?? ""),
            },
          );
        }

        this.armFirstIngest(
          sigilConfigIsFresh(
            this.alepha.store.get(sigilClientAtom),
            this.dateTime.nowMillis(),
          ),
        );
      });
    },
  });

  /**
   * Starts the wait that the queue is held for, and with it decides what the
   * page load's one request is waiting on.
   *
   * Arming is what the render hook contributes, and it matters that the wait
   * starts here rather than at `start`: the pageview is queued by that hook, so
   * an ingest sent before it would carry an empty envelope and leave the view
   * for a later request — the second request this exists to remove. LCP that
   * already arrived is therefore honoured *now*, not earlier.
   *
   * ## The two waits
   *
   * A page whose stamped config has gone stale (a prerendered file, an edge
   * cache, a restored document) has to ask, because until the answer arrives
   * its feedback button cannot know whether to render. So it waits only for the
   * page to settle: LCP, or {@link firstIngestDelayMs} as the ceiling for a
   * browser that never dispatches one. Its engagement follows in a request of
   * its own, ten seconds later. That is the price of asking early, and only
   * pages served from something that kept them pay it.
   *
   * A page whose config is fresh has nothing to ask for, so it waits for the
   * last fact about the load to be known: whether the visitor engaged, which
   * {@link dwellMs} settles. Every earlier signal (the view, TTFB, FCP, LCP)
   * has landed well before then, so the whole load reports itself in one
   * request instead of two.
   *
   * The fresh wait arms no timer of its own on purpose. `resetEngagement` has
   * already scheduled the dwell, and a second timer set to the same delay would
   * make which request the engagement lands in a question of which `setTimeout`
   * was created first.
   */
  protected armFirstIngest(configIsFresh: boolean) {
    if (this.firstIngestArmed) return;
    this.firstIngestArmed = true;
    this.firstIngestWaitsForLcp = !configIsFresh;

    if (configIsFresh) return;

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
    // Only the stale-config wait is a wait for LCP. A fresh page is waiting on
    // the engagement verdict, and the main content having painted says nothing
    // about that.
    if (this.firstIngestArmed && this.firstIngestWaitsForLcp) {
      this.sendFirstIngest();
    }
  }

  /**
   * Sends everything collected so far, once, and lifts the hold the load was
   * assembled under.
   *
   * Forced only on the wait that had something to ask. An empty envelope buys
   * exactly one thing, and it is the only way a page with every tracker off ever
   * learns it was switched back on — and only a page whose config was already
   * stale needs to buy it. A fresh one knows, so when it has nothing to say it
   * says nothing.
   */
  protected sendFirstIngest() {
    if (this.firstIngestSent) return;
    this.firstIngestSent = true;

    if (this.firstIngestTimer) {
      clearTimeout(this.firstIngestTimer);
      this.firstIngestTimer = undefined;
    }

    void this.queue?.release({ force: this.firstIngestWaitsForLcp });
  }

  /**
   * Attaches the three engagement signals, once, for the lifetime of the page.
   *
   * Listeners are page-level and permanent rather than re-attached per
   * navigation: {@link resetEngagement} moves the target, so re-binding on
   * every route change would only add ways to leak a listener.
   *
   * `scroll` and `click` are passive and cheap; the dwell timer covers the
   * reader who opens a short page, reads it without moving, and leaves. All
   * three are things an automated fetch does not do, which is the entire
   * reason this is measured behaviourally rather than guessed from a
   * user-agent.
   */
  protected observeEngagement() {
    const mark = () => this.markEngaged();
    (window as any).addEventListener("scroll", mark, { passive: true });
    (window as any).addEventListener("click", mark, { passive: true });
    (window as any).addEventListener("keydown", mark, { passive: true });
  }

  /**
   * Points engagement at a new path and restarts the dwell timer.
   */
  protected resetEngagement(path: string) {
    this.engagementPath = path;
    this.engagementSettled = false;
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    this.dwellTimer = setTimeout(() => this.markEngaged(), this.dwellMs);
  }

  /**
   * Settles engagement for the current path, at most once per path, and sends
   * what the load has been holding.
   *
   * Recording is gated on the views flag for the same reason `dropDisabled`
   * clears both arrays together: an `engaged` count that outlives the `count`
   * it is a fraction of is worse than no count at all. Settling is not gated,
   * because the verdict is reached either way and the opening envelope is
   * waiting on the verdict, not on the row.
   */
  protected markEngaged() {
    if (this.engagementSettled) return;
    if (!this.engagementPath) return;
    this.engagementSettled = true;
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = undefined;
    }

    if (this.wants("views")) {
      this.queue?.addEngagement(this.engagementPath, this.dateTime.nowMillis());
    }

    if (!this.firstIngestArmed || this.firstIngestWaitsForLcp) {
      // The release belongs to the LCP wait, not to this. Before that wait
      // ends the row simply rides the opening envelope; after it, nothing else
      // is coming for this path (the early signals are long gone, and CLS/INP
      // only finalize at hidden), so a debounce window here would be five
      // seconds spent waiting for an envelope that cannot grow.
      if (this.firstIngestSent) void this.queue?.flush();
      return;
    }

    // The verdict was the last thing the opening envelope was waiting for.
    this.sendFirstIngest();
  }

  /**
   * Returns the list of pending view paths in the queue.
   * Useful for testing and debugging.
   */
  public debugPendingViews(): string[] {
    return this.queue?.pendingViews() ?? [];
  }

  /**
   * Returns the referrer attached to each pending view, positionally aligned
   * with {@link debugPendingViews}. Only a page load's own view ever carries
   * one — see the `react:browser:render` handler.
   */
  public debugPendingViewReferrers(): Array<string | undefined> {
    return this.queue?.pendingViewReferrers() ?? [];
  }

  /**
   * The pending views in full, and the paths engagement has been recorded for.
   * Both exist for tests; nothing in the app reads them.
   */
  public debugPendingViewRecords() {
    return this.queue?.pendingViewRecords() ?? [];
  }

  public debugPendingEngagements(): string[] {
    return this.queue?.pendingEngagements() ?? [];
  }

  /**
   * Whether the opening envelope is still being held. See `SigilQueue.hold`.
   */
  public debugQueueHeld(): boolean {
    return this.queue?.isHeld() ?? false;
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

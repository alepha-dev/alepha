import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { sigilClientAtom } from "../shared/sigilClientAtom.ts";
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
 * Sampling is applied here too, at the source: an app told to keep a tenth of
 * its vitals sends a tenth, rather than sending everything for the sink to
 * throw away. The bandwidth and the battery belong to the visitor. Unlike the
 * gates, it is decided once per page load and then held — see {@link wants}.
 */
export class SigilBrowserProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected queue?: SigilQueue;

  /**
   * This page load's sampling verdict per tracker, with the rate it was rolled
   * against. See {@link wants} for why it is remembered rather than re-rolled.
   */
  protected readonly sampled = new Map<
    SigilTracker,
    { rate: number; keep: boolean }
  >();

  protected readonly start = $hook({
    on: "start",
    handler: () => {
      if (typeof window === "undefined") return;
      if (!this.alepha.isProduction()) return;

      const send = async (env: object): Promise<void> => {
        await fetch("/api/sigil/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(env),
          keepalive: true,
          credentials: "same-origin",
        } as any).catch(() => {});
      };

      this.queue = new SigilQueue(send as any);

      (this.alepha.events as any).on("react:transition:end", (ev: any) => {
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

      new SigilVitals((m) => {
        if (!this.wants("vitals")) return;
        this.queue!.addVital({
          path: (location as any).pathname,
          metric: m.metric,
          value: m.value,
          ts: this.dateTime.nowMillis(),
        });
      }).observe();

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
        if (!this.wants("views")) return;
        this.queue!.addView(
          (location as any).pathname,
          this.dateTime.nowMillis(),
        );
      });
    },
  });

  /**
   * Returns the list of pending view paths in the queue.
   * Useful for testing and debugging.
   */
  public debugPendingViews(): string[] {
    return this.queue?.pendingViews() ?? [];
  }

  /**
   * Whether this event should be collected: the tracker is on, and this page
   * load survives the sink's sampling rate.
   *
   * The kill-switch is read live, per event — that is the whole point of a
   * kill-switch, and the atom can be rehydrated under it.
   *
   * **The sampling roll is not.** It used to be, and that biased the one number
   * this package calls trustworthy. The `visitor` stamp only reaches the sink
   * when an envelope is actually sent, so under per-event sampling a visitor
   * with one pageview was far likelier to send nothing at all than a visitor
   * with ten: the unique count fell away non-linearly with the rate and the
   * survivors skewed engaged. Rolling once and reusing the answer means a
   * sampled-in visitor contributes every view and a sampled-out one contributes
   * none, so counts stay scalable and uniques stay unbiased. It is also what
   * makes a funnel measurable at all — thinning each step independently would
   * multiply every step-to-step conversion by the sampling rate.
   *
   * Kept in memory, deliberately. A session id in `sessionStorage` would
   * survive a reload and be more accurate, and it would also put this package
   * back inside ePrivacy Art. 5(3) — storage on terminal equipment — for every
   * app that installs it. A reload re-rolls; that residual bias is a great deal
   * smaller than the one being fixed, and it costs no downstream consent.
   *
   * The roll is cached against the rate that produced it, so the first events
   * of a page load — buffered vitals fire before the atom is hydrated — do not
   * pin the pre-hydration default of 1 for the rest of the visit. When
   * hydration brings a real rate, it re-rolls once and then holds.
   *
   * Errors are never sampled away even when a rate is configured for them: the
   * first occurrence of a new crash is the one that matters, and a rate below 1
   * would sometimes drop exactly that one. Sampling errors is a thing to do at
   * the sink, on groups, not at the source on individuals.
   */
  protected wants(tracker: SigilTracker): boolean {
    const config = this.alepha.store.get(sigilClientAtom);
    if (config.enabled[tracker] === false) return false;
    if (tracker === "errors") return true;

    const rate = config.sampling[tracker] ?? 1;
    const rolled = this.sampled.get(tracker);
    if (rolled && rolled.rate === rate) return rolled.keep;

    const keep = rate >= 1 || Math.random() < rate;
    this.sampled.set(tracker, { rate, keep });
    return keep;
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

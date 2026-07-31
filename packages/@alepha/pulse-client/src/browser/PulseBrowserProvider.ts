import { $hook, $inject, Alepha } from "alepha";
import { pulseClientAtom } from "../shared/pulseClientAtom.ts";
import type { PulseTracker } from "../shared/pulseFeatures.ts";
import { PulseQueue } from "./PulseQueue.ts";
import { PulseVitals } from "./PulseVitals.ts";

/**
 * Browser bootstrap: subscribes to framework hooks, batches telemetry, and
 * posts the envelope to the same-origin `/api/pulse/ingest` proxy. No
 * credential lives here. Active in production + browser only.
 *
 * Each tracker is gated by {@link pulseClientAtom} — the SSR-hydrated view
 * of what the sink currently wants. Gates are read lazily, per event, because
 * the atom is hydrated on `ready`, after this `start` hook has attached its
 * listeners; reading them once here would freeze the pre-hydration defaults.
 *
 * Sampling is applied here too, at the source: an app told to keep a tenth of
 * its vitals sends a tenth, rather than sending everything for the sink to
 * throw away. The bandwidth and the battery belong to the visitor.
 */
export class PulseBrowserProvider {
  protected readonly alepha = $inject(Alepha);
  protected queue?: PulseQueue;

  protected readonly start = $hook({
    on: "start",
    handler: () => {
      if (typeof window === "undefined") return;
      if (!this.alepha.isProduction()) return;

      const send = async (env: object): Promise<void> => {
        await fetch("/api/pulse/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(env),
          keepalive: true,
          credentials: "same-origin",
        } as any).catch(() => {});
      };

      this.queue = new PulseQueue(send as any);

      (this.alepha.events as any).on("react:transition:end", (ev: any) => {
        if (!this.wants("views")) return;
        this.queue!.addView(
          ev.state?.url?.pathname ?? (location as any).pathname,
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

      new PulseVitals((m) => {
        if (!this.wants("vitals")) return;
        this.queue!.addVital({
          path: (location as any).pathname,
          metric: m.metric,
          value: m.value,
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
        this.queue!.addView((location as any).pathname);
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
   * Whether this event should be collected: the tracker is on, and it survives
   * the sink's sampling rate.
   *
   * Both are read per event. Before hydration the atom holds its defaults —
   * everything on, nothing sampled out — which errs toward collecting; the
   * server applies the real config on the way to the sink.
   *
   * Errors are never sampled away even when a rate is configured for them: the
   * first occurrence of a new crash is the one that matters, and a rate below 1
   * would sometimes drop exactly that one. Sampling errors is a thing to do at
   * the sink, on groups, not at the source on individuals.
   */
  protected wants(tracker: PulseTracker): boolean {
    const config = this.alepha.store.get(pulseClientAtom);
    if (config.enabled[tracker] === false) return false;
    if (tracker === "errors") return true;
    const rate = config.sampling[tracker] ?? 1;
    return rate >= 1 || Math.random() < rate;
  }

  /**
   * Normalises any thrown value into the error shape expected by the ingest
   * envelope. Truncates message and stack to safe lengths.
   */
  protected toError(err: any, sourceUrl: string) {
    return {
      name: err?.name ?? "Error",
      message: String(err?.message ?? err ?? "").slice(0, 2000),
      stack: String(err?.stack ?? "").slice(0, 4096),
      sourceUrl,
    };
  }
}

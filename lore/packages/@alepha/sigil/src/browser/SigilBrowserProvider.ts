import { $hook, $inject, Alepha } from "alepha";
import { SigilTelemetryQueue } from "./SigilTelemetryQueue.ts";
import { SigilVitals } from "./SigilVitals.ts";

/**
 * Browser bootstrap: subscribes to framework hooks, batches telemetry, and
 * posts the mutualised envelope to the same-origin /api/sigil/ingest proxy.
 * No secret needed here. Active in production + browser only.
 */
export class SigilBrowserProvider {
  protected readonly alepha = $inject(Alepha);
  protected queue?: SigilTelemetryQueue;

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

      this.queue = new SigilTelemetryQueue(send as any);

      (this.alepha.events as any).on("react:transition:end", (ev: any) => {
        this.queue!.addView(
          ev.state?.url?.pathname ?? (location as any).pathname,
        );
      });

      (this.alepha.events as any).on("react:action:error", (ev: any) => {
        this.queue!.addError(this.toError(ev.error, (location as any).href));
      });

      (window as any).addEventListener("error", (e: any) => {
        this.queue!.addError(
          this.toError(e.error ?? e, (location as any).href),
        );
      });

      (window as any).addEventListener("unhandledrejection", (e: any) => {
        this.queue!.addError(this.toError(e.reason, (location as any).href));
      });

      new SigilVitals((m) => {
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

      this.queue.addView((location as any).pathname);
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

import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Monitor } from "../entities/monitors.ts";
import type { ProbeResult } from "../schemas/probeResultSchema.ts";
import { UptimeHttpProber } from "./UptimeHttpProber.ts";
import { UptimeSocketProber } from "./UptimeSocketProber.ts";

/**
 * The substitutable probe boundary, independent of its scheduler.
 */
export class UptimeProber {
  protected readonly http = $inject(UptimeHttpProber);
  protected readonly socket = $inject(UptimeSocketProber);
  protected readonly clock = $inject(DateTimeProvider);

  public async probe(monitor: Monitor): Promise<ProbeResult> {
    if (monitor.kind === "http") return this.http.probe(monitor);
    if (monitor.kind !== "push") return this.socket.probe(monitor);
    // A tick is not a push. Keep the receipt clock separate from lastCheckedAt.
    const lastReceipt = Date.parse(monitor.lastPushedAt ?? monitor.statusSince);
    const ok =
      this.clock.nowMillis() - lastReceipt <= monitor.intervalSecs * 1000;
    return {
      ok,
      result: ok ? "up" : "timeout",
      latencyMs: 0,
      ...(ok ? {} : { error: "No push received within the expected interval" }),
    };
  }
}

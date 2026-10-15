import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
  DbVersionMismatchError,
} from "alepha/orm";

import {
  type MonitorIncident,
  monitorIncidents,
} from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import type { ProbeResult } from "../schemas/probeResultSchema.ts";

export interface UptimeTransition {
  kind: "opened" | "closed";
  monitor: Monitor;
  incident: MonitorIncident;
}

/**
 * State is saved with a version guard. Incident boundaries reconcile from
 * that saved state, so a partial D1 write is repairable on the next tick.
 */
export class UptimeStateService {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);

  public async apply(
    monitor: Monitor,
    result: ProbeResult,
    checkedAt: number,
  ): Promise<UptimeTransition[]> {
    const transitions: UptimeTransition[] = [];
    // Preserve a saved outage even if its incident insert failed and this probe recovers.
    if (monitor.status === "down") {
      const preceding = await this.reconcile(monitor);
      if (preceding) transitions.push(preceding);
    }
    const at = new Date(checkedAt).toISOString();
    const failures = result.ok ? 0 : monitor.failures + 1;
    const status = result.ok
      ? "up"
      : failures >= monitor.confirmations
        ? "down"
        : monitor.status;
    const interval = monitor.intervalSecs * 1000;
    const scheduled = Date.parse(monitor.nextCheckAt);
    const nextCheckAt = new Date(
      scheduled +
        (Math.floor(Math.max(0, checkedAt - scheduled) / interval) + 1) *
          interval,
    ).toISOString();
    const updated: Monitor = {
      ...monitor,
      failures,
      status,
      statusSince: status === monitor.status ? monitor.statusSince : at,
      lastCheckedAt: at,
      nextCheckAt,
      lastLatencyMs: result.latencyMs,
      lastError: result.error,
      lastResult: result.result,
      certExpiresAt: result.certExpiresAt ?? monitor.certExpiresAt,
    };
    try {
      await this.monitors.save(updated);
    } catch (error) {
      // A pause, edit, push or deletion won while the network probe ran.
      if (
        error instanceof DbVersionMismatchError ||
        error instanceof DbEntityNotFoundError
      )
        return transitions;
      throw error;
    }
    const transition = await this.reconcile(updated, monitor.lastError);
    if (transition) transitions.push(transition);
    return transitions;
  }

  protected async createIncident(monitor: Monitor): Promise<MonitorIncident> {
    return this.incidents.create({
      monitorId: monitor.id,
      openKey: monitor.id,
      startedAt: monitor.statusSince,
      cause: monitor.lastResult ?? "connection",
      lastError: monitor.lastError,
    });
  }

  protected async reconcile(
    monitor: Monitor,
    previousError?: string,
  ): Promise<UptimeTransition | undefined> {
    const open = await this.incidents.findOne({
      where: { monitorId: monitor.id, endedAt: { isNull: true } },
    });
    if (monitor.status === "down" && !open) {
      try {
        const incident = await this.createIncident(monitor);
        return { kind: "opened", monitor, incident };
      } catch (error) {
        if (error instanceof DbConflictError) return undefined;
        throw error;
      }
    }
    if (monitor.status === "up" && open) {
      const incident = {
        ...open,
        endedAt: monitor.statusSince,
        openKey: undefined,
        lastError: previousError ?? open.lastError,
      };
      await this.incidents.save(incident);
      return { kind: "closed", monitor, incident };
    }
    return undefined;
  }
}

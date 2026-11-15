import { AutomationSourceRepository } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
  DbVersionMismatchError,
} from "alepha/orm";
import { ConflictError } from "alepha/server";

import {
  type MonitorIncident,
  monitorIncidents,
} from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import type { ProbeResult } from "../schemas/probeResultSchema.ts";
import { UptimeAutomationFields } from "./UptimeAutomationFields.ts";

export interface UptimeTransition {
  kind: "opened" | "closed";
  monitor: Monitor;
  incident: MonitorIncident;
}

/**
 * State is saved with a version guard. Incident boundaries reconcile from
 * that saved state, so a partial D1 write is repairable on the next tick.
 *
 * Opening an incident records `monitor.down` and closing it `monitor.up`
 * (#Q3610), in the same write as the incident, the way deployments record
 * `deploy.*`: a single failed probe opens nothing, so it records nothing.
 */
export class UptimeStateService {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly sources = $inject(
    AutomationSourceRepository.of(monitorIncidents),
  );
  protected readonly projects = $repository(projects);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly fields = $inject(UptimeAutomationFields);

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
    // Push intervals measure allowed silence, not how often silence is checked.
    const interval =
      (monitor.kind === "push" ? 60 : monitor.intervalSecs) * 1000;
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
    const incident: MonitorIncident = {
      id: this.crypto.randomUUID(),
      monitorId: monitor.id,
      openKey: monitor.id,
      startedAt: monitor.statusSince,
      cause: monitor.lastResult ?? "connection",
      lastError: monitor.lastError,
    };
    return this.sources.sourceCreate(
      incident,
      { openKey: monitor.id },
      {
        projectId: monitor.projectId,
        identity: `monitor:${incident.id}:down`,
        resourceId: incident.id,
        name: "monitor.down",
        fields: this.fields.build(
          await this.projects.getById(monitor.projectId),
          monitor,
          incident,
          "down",
        ),
      },
    );
  }

  protected async closeIncident(
    open: MonitorIncident,
    monitor: Monitor,
    previousError?: string,
  ): Promise<MonitorIncident> {
    const closed: MonitorIncident = {
      ...open,
      endedAt: monitor.statusSince,
      openKey: undefined,
      lastError: previousError ?? open.lastError,
    };
    return this.sources.sourceUpdate(
      { id: open.id, endedAt: { isNull: true } },
      {
        endedAt: closed.endedAt,
        // `null`, not `undefined`: an update strips undefined keys, which
        // would leave the open key, and so the incident, open.
        openKey: null as never,
        lastError: closed.lastError,
      },
      {
        projectId: monitor.projectId,
        identity: `monitor:${open.id}:up`,
        resourceId: open.id,
        name: "monitor.up",
        fields: this.fields.build(
          await this.projects.getById(monitor.projectId),
          monitor,
          closed,
          "up",
        ),
      },
    );
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
        // Another tick opened it first: the open key is unique, and the
        // source insert refuses when an open incident already exists.
        if (error instanceof DbConflictError || error instanceof ConflictError)
          return undefined;
        throw error;
      }
    }
    if (monitor.status === "up" && open) {
      try {
        const incident = await this.closeIncident(open, monitor, previousError);
        return { kind: "closed", monitor, incident };
      } catch (error) {
        // Another tick closed it first.
        if (error instanceof ConflictError) return undefined;
        throw error;
      }
    }
    return undefined;
  }
}

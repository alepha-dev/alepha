import { ProjectEventCatalog, ProjectEventFilters } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { monitors } from "../entities/monitors.ts";

/**
 * Ship's project events (#Q3889): deploys and monitors. A filter narrows
 * each to one app or monitor. The host events are core's since #E166
 * (`HostProjectEvents`).
 */
export class ShipProjectEvents {
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly filters = $inject(ProjectEventFilters);
  protected readonly instances = $repository(appInstances);
  protected readonly monitors = $repository(monitors);

  constructor() {
    // What a filter may name, picked on the Notifications page (#Q3892):
    // the project's own apps and monitors, by the value each event
    // carries in its filter field.
    this.filters.register("app", async (projectId) =>
      [
        ...new Set(
          (
            await this.instances.findMany({
              where: { projectId },
              orderBy: "app",
              limit: 500,
            })
          ).map((instance) => instance.app),
        ),
      ].map((app) => ({ value: app, label: app })),
    );
    this.filters.register("monitor", async (projectId) =>
      (
        await this.monitors.findMany({
          where: { projectId },
          orderBy: "name",
          limit: 500,
        })
      ).map((monitor) => ({ value: monitor.id, label: monitor.name })),
    );
    this.catalog.register({
      name: "errors.threshold_crossed",
      label: "Open errors over their threshold",
      resource: "errors",
      subject: "project",
      fields: { count: "number", threshold: "number" },
      needs: { capability: "ship" },
      permission: "error:read",
      message: (it) => ({
        title: `${this.text(it.count)} open errors`,
        text: `Over the threshold of ${this.text(it.threshold)}.`,
      }),
    });
    for (const [name, label] of [
      ["deploy.failed", "Deploy failed"],
      ["deploy.succeeded", "Deploy succeeded"],
    ] as const)
      this.catalog.register({
        name,
        label,
        resource: "apps",
        subject: "deployment",
        fields: {
          deployment_id: "text",
          app: "text",
          env: "text",
          tag: "text",
          digest: "text",
          reason: "text",
        },
        needs: { capability: "ship", option: "deploy" },
        permission: "app:read",
        filter: { field: "app", resource: "app" },
        message: (it) =>
          name === "deploy.failed"
            ? {
                title: `${this.text(it.app)} failed to deploy to ${this.text(it.env)}`,
                text:
                  it.reason === "timeout"
                    ? "The deploy never started before its timeout."
                    : it.reason === "abandoned"
                      ? "The deploy stopped reporting and was abandoned."
                      : "The deployment record says what went wrong.",
              }
            : {
                title: `${this.text(it.app)} deployed to ${this.text(it.env)}`,
                text: `Tag ${this.text(it.tag) || "latest"} is live.`,
              },
      });
    for (const [name, label] of [
      ["monitor.down", "Monitor down"],
      ["monitor.up", "Monitor recovered"],
    ] as const)
      this.catalog.register({
        name,
        label,
        resource: "monitors",
        subject: "monitor",
        fields: {
          monitor_id: "text",
          monitor: "text",
          state: "text",
          kind: "text",
          target: "text",
          cause: "text",
          error: "text",
          started_at: "text",
          ended_at: "text",
          duration_secs: "number",
        },
        needs: { capability: "ship", option: "uptime" },
        permission: "app:read",
        filter: { field: "monitor_id", resource: "monitor" },
        message: (it) =>
          name === "monitor.down"
            ? {
                title: `${this.text(it.monitor)} is down`,
                text: `${this.text(it.target)}: ${this.text(it.error) || this.text(it.cause)}.`,
              }
            : {
                title: `${this.text(it.monitor)} recovered`,
                text: `It was down for ${this.duration(it.duration_secs)}.`,
              },
      });
  }

  protected text(value: string | number | boolean | null | undefined): string {
    return value === null || value === undefined ? "" : String(value);
  }

  protected duration(value: unknown): string {
    const secs = typeof value === "number" ? value : 0;
    if (secs < 60) return `${secs} s`;
    if (secs < 3600) return `${Math.round(secs / 60)} min`;
    return `${Math.round(secs / 360) / 10} h`;
  }
}

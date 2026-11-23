import { ProjectEventCatalog, ProjectEventFilters } from "@lore/core/api";
import { hosts } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { monitors } from "../entities/monitors.ts";

/**
 * Ship's project events (#Q3889): deploys, monitors and hosts. A filter
 * narrows each to one app, monitor or host.
 */
export class ShipProjectEvents {
  protected static readonly HOST_TITLES: Record<string, string> = {
    "host.credential_invalid": "has a Cloudflare token that stopped working",
    "host.expired": "is past its time to live",
    "host.offline": "is offline",
    "host.online": "is back online",
  };
  protected static readonly HOST_TEXTS: Record<string, string> = {
    "host.credential_invalid": "Replace the token in the host's settings.",
    "host.expired": "Its time to live ran out.",
    "host.offline": "It stopped reporting past its grace period.",
    "host.online": "It is reporting again.",
  };
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly filters = $inject(ProjectEventFilters);
  protected readonly hosts = $repository(hosts);
  protected readonly instances = $repository(appInstances);
  protected readonly monitors = $repository(monitors);

  constructor() {
    // What a filter may name, picked on the Notifications page (#Q3892):
    // the project's own hosts, apps and monitors, by the value each event
    // carries in its filter field.
    this.filters.register("host", async (projectId) =>
      (
        await this.hosts.findMany({
          where: { projectId },
          orderBy: "slug",
          limit: 500,
        })
      ).map((host) => ({ value: host.id, label: host.label ?? host.slug })),
    );
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
    for (const [name, label] of [
      ["host.credential_invalid", "Host token stopped working"],
      ["host.expired", "Host past its TTL"],
      ["host.offline", "Host offline"],
      ["host.online", "Host back online"],
    ] as const)
      this.catalog.register({
        name,
        label,
        resource: "hosts",
        subject: "host",
        fields: {
          host_id: "text",
          host: "text",
          kind: "text",
          state: "text",
          since: "text",
        },
        needs: { capability: "ship" },
        permission: "host:read",
        filter: { field: "host_id", resource: "host" },
        message: (it) => ({
          title: `${this.text(it.host)} ${ShipProjectEvents.HOST_TITLES[name]}`,
          text: ShipProjectEvents.HOST_TEXTS[name],
        }),
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

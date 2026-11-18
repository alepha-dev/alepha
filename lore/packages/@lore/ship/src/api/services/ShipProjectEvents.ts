import { ProjectEventCatalog } from "@lore/core/api";
import { $inject } from "alepha";

/**
 * Ship's project events (#Q3889): deploys, monitors and hosts. A filter
 * narrows each to one app, monitor or host.
 */
export class ShipProjectEvents {
  protected readonly catalog = $inject(ProjectEventCatalog);

  constructor() {
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
      });
  }
}

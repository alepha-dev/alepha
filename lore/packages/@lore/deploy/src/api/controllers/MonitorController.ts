import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { type Monitor, monitors } from "../entities/monitors.ts";
import { monitorConfigSchema } from "../schemas/monitorConfigSchema.ts";
import { monitorCreateResourceSchema } from "../schemas/monitorCreateResourceSchema.ts";
import { monitorListQuerySchema } from "../schemas/monitorListQuerySchema.ts";
import { monitorListResourceSchema } from "../schemas/monitorListResourceSchema.ts";
import { monitorResourceSchema } from "../schemas/monitorResourceSchema.ts";
import { UptimeMonitorService } from "../services/UptimeMonitorService.ts";
import { UptimeReadService } from "../services/UptimeReadService.ts";

export class MonitorController {
  protected readonly monitors = $repository(monitors);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly service = $inject(UptimeMonitorService);
  protected readonly reads = $inject(UptimeReadService);

  public readonly listMonitors = $action({
    method: "GET",
    path: "/projects/:projectId/monitors",
    use: [$ownsProject({ param: "projectId", requires: "app:read" })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: monitorListQuerySchema,
      response: monitorListResourceSchema,
    },
    handler: async ({ params, query }) =>
      this.reads.list(params.projectId, query.window),
  });

  public readonly createMonitor = $action({
    method: "POST",
    path: "/projects/:projectId/monitors",
    use: [
      $ownsProject({
        param: "projectId",
        requires: "app:manage",
        capability: { key: "apps", option: "uptime" },
      }),
    ],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: monitorConfigSchema,
      response: monitorCreateResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.service.create(params.projectId, body),
  });

  public readonly updateMonitor = $action({
    method: "PUT",
    path: "/monitors/:monitorId",
    use: [
      $ownsProject({
        repository: () => this.monitors,
        param: "monitorId",
        requires: "app:manage",
        capability: { key: "apps", option: "uptime" },
      }),
    ],
    schema: {
      params: z.object({ monitorId: z.uuid() }),
      body: monitorConfigSchema,
      response: monitorResourceSchema,
    },
    handler: async ({ body }) =>
      this.service.update(this.owned.get<Monitor>(), body),
  });

  public readonly setMonitorActive = $action({
    method: "PUT",
    path: "/monitors/:monitorId/active",
    use: [
      $ownsProject({
        repository: () => this.monitors,
        param: "monitorId",
        requires: "app:manage",
        capability: { key: "apps", option: "uptime" },
      }),
    ],
    schema: {
      params: z.object({ monitorId: z.uuid() }),
      body: z.object({ active: z.boolean() }),
      response: monitorResourceSchema,
    },
    handler: async ({ body }) =>
      this.service.setActive(this.owned.get<Monitor>(), body.active),
  });

  public readonly deleteMonitor = $action({
    method: "DELETE",
    path: "/monitors/:monitorId",
    use: [
      $ownsProject({
        repository: () => this.monitors,
        param: "monitorId",
        requires: "app:manage",
        capability: { key: "apps", option: "uptime" },
      }),
    ],
    schema: { params: z.object({ monitorId: z.uuid() }), response: okSchema },
    handler: async () => {
      await this.monitors.deleteById(this.owned.get<Monitor>().id);
      return { ok: true };
    },
  });
}

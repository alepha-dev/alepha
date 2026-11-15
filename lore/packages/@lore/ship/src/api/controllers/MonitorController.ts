import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { type Monitor, monitors } from "../entities/monitors.ts";
import { monitorConfigSchema } from "../schemas/monitorConfigSchema.ts";
import { monitorCreateBodySchema } from "../schemas/monitorCreateBodySchema.ts";
import { monitorCreateResourceSchema } from "../schemas/monitorCreateResourceSchema.ts";
import { monitorDetailResourceSchema } from "../schemas/monitorDetailResourceSchema.ts";
import { monitorListQuerySchema } from "../schemas/monitorListQuerySchema.ts";
import { monitorListResourceSchema } from "../schemas/monitorListResourceSchema.ts";
import { monitorResourceSchema } from "../schemas/monitorResourceSchema.ts";
import { UptimeMonitorOwners } from "../services/UptimeMonitorOwners.ts";
import { UptimeMonitorService } from "../services/UptimeMonitorService.ts";
import { UptimeReadService } from "../services/UptimeReadService.ts";

export class MonitorController {
  protected readonly monitors = $repository(monitors);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly service = $inject(UptimeMonitorService);
  protected readonly reads = $inject(UptimeReadService);
  protected readonly owners = $inject(UptimeMonitorOwners);

  public readonly listMonitors = $action({
    method: "GET",
    path: "/projects/:projectId/monitors",
    use: [$ownsProject({ param: "projectId", requires: "app:read" })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: monitorListQuerySchema,
      response: monitorListResourceSchema,
    },
    handler: async ({ params, query }) => {
      await this.owners.adopt(params.projectId);
      return this.reads.list(params.projectId, query.window);
    },
  });

  public readonly getMonitorDetail = $action({
    method: "GET",
    path: "/monitors/:monitorId",
    use: [
      $ownsProject({
        repository: () => this.monitors,
        param: "monitorId",
        requires: "app:read",
      }),
    ],
    schema: {
      params: z.object({ monitorId: z.uuid() }),
      query: monitorListQuerySchema,
      response: monitorDetailResourceSchema,
    },
    handler: async ({ query }) =>
      this.reads.detail(this.owned.get<Monitor>(), query.window),
  });

  public readonly createMonitor = $action({
    method: "POST",
    path: "/projects/:projectId/monitors",
    use: [
      $ownsProject({
        param: "projectId",
        requires: "app:manage",
        capability: { key: "ship", option: "uptime" },
      }),
    ],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: monitorCreateBodySchema,
      response: monitorCreateResourceSchema,
    },
    // A monitor belongs to an app copy (#Q3657): there is no standalone
    // monitor, and a copy from another project is refused.
    handler: async ({ params, body }) => {
      const { appInstanceId, ...config } = body;
      const owner = await this.owners.ownerOf(params.projectId, appInstanceId);
      return this.service.create(params.projectId, config, {
        appInstanceId: owner.id,
      });
    },
  });

  public readonly updateMonitor = $action({
    method: "PUT",
    path: "/monitors/:monitorId",
    use: [
      $ownsProject({
        repository: () => this.monitors,
        param: "monitorId",
        requires: "app:manage",
        capability: { key: "ship", option: "uptime" },
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
        capability: { key: "ship", option: "uptime" },
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
        capability: { key: "ship", option: "uptime" },
      }),
    ],
    schema: { params: z.object({ monitorId: z.uuid() }), response: okSchema },
    handler: async () => {
      await this.monitors.deleteById(this.owned.get<Monitor>().id);
      return { ok: true };
    },
  });
}

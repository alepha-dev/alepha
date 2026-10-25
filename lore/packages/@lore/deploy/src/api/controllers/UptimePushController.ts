import { $ownsProject } from "@lore/core/api";
import { $inject, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, $route } from "alepha/server";

import { type Monitor, monitors } from "../entities/monitors.ts";
import { UptimePushService } from "../services/UptimePushService.ts";

export class UptimePushController {
  protected readonly alepha = $inject(Alepha);
  protected readonly monitors = $repository(monitors);
  protected readonly pushes = $inject(UptimePushService);
  protected readonly owned = $inject(OwnedResourceProvider);

  public readonly receiveUptimePush = $route({
    method: "GET",
    path: "/uptime/push/:token",
    schema: { params: z.object({ token: z.string().max(256) }) },
    handler: async ({ params, reply }) => {
      reply.setHeader("cache-control", "no-store");
      // This GET writes. Reopen on the D1 primary instead of using the
      // read-replica session the HTTP method normally selects.
      this.alepha.store.set("alepha.orm.d1.bookmark", "first-primary", {
        skipEvents: true,
      });
      this.alepha.store.set("alepha.orm.d1.session", undefined, {
        skipEvents: true,
      });
      await this.pushes.accept(params.token);
      reply.status = 204;
    },
  });

  public readonly rotateMonitorPushToken = $action({
    method: "POST",
    path: "/monitors/:monitorId/push-token",
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
      response: z.object({ token: z.string() }),
    },
    handler: async () => ({
      token: await this.pushes.rotate(this.owned.get<Monitor>()),
    }),
  });
}

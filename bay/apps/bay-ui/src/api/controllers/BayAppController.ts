import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { bayAppSchema } from "../schemas/bayAppSchema.ts";
import { BayControlService } from "../services/BayControlService.ts";

/**
 * bay-ui's own API — the only surface the browser talks to.
 *
 * Every endpoint is `admin`-only and every one of them re-exposes a *narrowed*
 * bay-go operation. The browser never receives `BAY_TOKEN`, never learns the
 * control API's address, and cannot reach operations bay-ui chose not to
 * forward. That indirection is the whole point: the control API deploys code,
 * reads secrets and can delete every backup, so it gets exactly one caller.
 */
export class BayAppController {
  protected readonly bay = $inject(BayControlService);

  /**
   * Whether bay-ui can reach a Bay at all.
   *
   * Deliberately reachable by any signed-in user and deliberately separate from
   * `listApps`: "not configured yet" and "Bay is down" call for different
   * reactions, and collapsing them into one failed request hides which one it
   * is.
   */
  status = $action({
    method: "GET",
    path: "/bay/status",
    use: [$secure({ roles: ["admin"] })],
    description: "Whether bay-ui is configured to reach a Bay",
    schema: {
      response: z.object({
        configured: z.boolean(),
      }),
    },
    handler: async () => ({ configured: this.bay.configured }),
  });

  listApps = $action({
    method: "GET",
    path: "/bay/apps",
    use: [$secure({ roles: ["admin"] })],
    description: "Apps currently deployed on the Bay",
    schema: {
      response: z.array(bayAppSchema),
    },
    handler: async () => await this.bay.listApps(),
  });

  /**
   * Uploads an artifact and deploys it.
   *
   * `name` is optional: left empty, bay-go reads `project` out of the
   * artifact's own `dist/manifest.json`. Asking the operator to retype a name
   * the artifact already carries is how the two drift apart.
   */
  deploy = $action({
    method: "POST",
    path: "/bay/apps",
    use: [$secure({ roles: ["admin"] })],
    description: "Deploy an artifact produced by `alepha pack`",
    schema: {
      body: z.object({
        file: z.file(),
        name: z.text(),
        env: z.text({ default: "production" }),
        domain: z.text().optional(),
      }),
      response: z.object({
        release: z.text(),
        url: z.text(),
        sleepEligible: z.boolean(),
        restore: z.record(z.text(), z.any()),
      }),
    },
    handler: async ({ body }) =>
      (await this.bay.deploy({
        file: body.file,
        name: body.name,
        env: body.env,
        domain: body.domain,
      })) as any,
  });

  stopApp = $action({
    method: "POST",
    path: "/bay/apps/:name/:env/stop",
    use: [$secure({ roles: ["admin"] })],
    description: "Stop a running app",
    schema: {
      params: z.object({
        name: z.text(),
        env: z.text(),
      }),
      response: z.object({
        stopped: z.boolean(),
      }),
    },
    handler: async ({ params }) => {
      await this.bay.stop(params.name, params.env);
      return { stopped: true };
    },
  });

  backupApp = $action({
    method: "POST",
    path: "/bay/apps/:name/:env/backup",
    use: [$secure({ roles: ["admin"] })],
    description: "Snapshot, verify and upload the app's database",
    schema: {
      params: z.object({
        name: z.text(),
        env: z.text(),
      }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) =>
      (await this.bay.backup(params.name, params.env)) as any,
  });
}

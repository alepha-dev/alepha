import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { appSecretResourceSchema } from "../schemas/appSecretResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AppSecretService } from "../services/AppSecretService.ts";

/**
 * The Environment tab's endpoints: what one deployed copy runs with.
 *
 * ## ⚠️ No response on this controller carries a value
 *
 * Not for a member, not for the owner, not on the way back out of a write. The
 * response schema is {@link appSecretResourceSchema}, a `pick` allowlist over
 * the row, so a column added to `app_secrets` cannot ride along by being
 * forgotten - and `valueSealed` is not in it.
 *
 * That is the property the whole quest turns on. A `type="password"` input is a
 * rendering hint: it still sends the real value to the client on every edit, so
 * the control has to be that the server never says it.
 *
 * ## The read/write split, and why the read is not owner-only
 *
 * Reads are member-gated like every other project read; writes are owner-only
 * and additionally take the `apps.deploy` capability. A member learns which
 * variables exist and four characters of the long ones, which is the same order
 * of exposure as the deploy log and the artifact list they can already read -
 * and the alternative, an owner-only read, would leave the tab answering 403 to
 * everyone it is shown to, with nothing on screen saying why.
 *
 * ⚠️ Reads do NOT take the capability, for the reason `DeployController`'s do
 * not: disabling a capability hides it and never deletes anything, so a project
 * that turns `deploy` off must get its list back untouched when it returns.
 */
export class AppSecretController {
  protected readonly secrets = $inject(AppSecretService);
  protected readonly instances = $repository(appInstances);

  /**
   * Declared above the actions: a `use: [...]` entry reading another field is a
   * field initializer, so a gate declared below its first use is `undefined` at
   * construction time.
   */
  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      owner: true,
      capability: { key: "apps", option: "deploy" },
    });

  protected ownsProject = () => $ownsProject({ param: "projectId" });

  listAppSecrets = $action({
    use: [$secure(), this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/apps/:instanceId/secrets",
    description: "What this deployed copy runs with. Never the values.",
    schema: {
      params: z.object({ projectId: z.integer(), instanceId: z.uuid() }),
      response: z.object({ items: z.array(appSecretResourceSchema) }),
    },
    handler: async ({ params }) => {
      await this.assertInstance(params.projectId, params.instanceId);
      const items = await this.secrets.list(params.instanceId);
      return { items } as any;
    },
  });

  setAppSecret = $action({
    use: [$secure(), this.writeGate()],
    method: "PUT",
    path: "/projects/:projectId/apps/:instanceId/secrets",
    description: "Set one variable, replacing whatever was there.",
    schema: {
      params: z.object({ projectId: z.integer(), instanceId: z.uuid() }),
      body: z.object({
        key: z.string().min(1).max(100),
        /**
         * ⚠️ The one place a plaintext appears on the wire, and it goes one
         * way. Nothing reads it back.
         */
        value: z.string().min(1).max(AppSecretService.MAX_VALUE_LENGTH),
      }),
      response: appSecretResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.assertInstance(params.projectId, params.instanceId);
      const row = await this.secrets.set({
        instanceId: params.instanceId,
        key: body.key,
        value: body.value,
        updatedBy: user?.id,
      });
      return row as any;
    },
  });

  deleteAppSecret = $action({
    use: [$secure(), this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/apps/:instanceId/secrets/:key",
    description: "Remove one variable.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        instanceId: z.uuid(),
        key: z.string().min(1).max(100),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.assertInstance(params.projectId, params.instanceId);
      const removed = await this.secrets.remove(params.instanceId, params.key);
      if (!removed) {
        throw new NotFoundError(
          `No variable named ${params.key} on this copy.`,
        );
      }
      return { ok: true };
    },
  });

  /**
   * That this instance belongs to the gated project.
   *
   * ⚠️ The cross-project guard, and it is not redundant with `$ownsProject`:
   * that gate proves the caller owns `:projectId`, and `:instanceId` is a
   * second, unrelated identifier from the same request. Without this, an owner
   * of any project could read or write another project's secret set by pairing
   * their own project id with somebody else's instance id. The same hole
   * `InsightsController`'s `?sigilId=` check closes.
   */
  protected async assertInstance(
    projectId: number,
    instanceId: string,
  ): Promise<void> {
    const instance = await this.instances.findOne({
      where: { id: { eq: instanceId }, projectId: { eq: projectId } },
    });
    if (!instance) {
      throw new NotFoundError("No such deployed copy in this project.");
    }
  }
}

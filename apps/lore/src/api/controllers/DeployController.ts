import { $inject, z } from "alepha";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { DeployJobs } from "../jobs/DeployJobs.ts";
import { releaseTagSchema } from "../schemas/releaseTagSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { DeployService } from "../services/DeployService.ts";
import { RollbackService } from "../services/RollbackService.ts";

/**
 * Starting a deploy, and following one.
 *
 * ## ⚠️ There is no `--estate` and there never will be
 *
 * The client names a project, a deployed copy and a tag. The estate is
 * resolved server-side from the `app_instances` row, because a client that can
 * name its own estate can deploy into somebody else's cloud account.
 *
 * ## ⚠️ This endpoint can only ever deploy STORED bytes
 *
 * The tag is what decides whether a deploy builds, and nothing here builds. CI
 * pushed `0.28.0` on Tuesday from a clean checkout; promoting it on Friday must
 * not rebuild from a different machine with a different `node_modules`, because
 * that is different bytes under the same name. `lore apps deploy` with no tag
 * builds and pushes first, then calls this.
 */
export class DeployController {
  protected readonly deploys = $inject(DeployService);
  protected readonly jobs = $inject(DeployJobs);
  protected readonly rollbacks = $inject(RollbackService);

  /**
   * Declared above the actions: a `use: [...]` entry reading another field is
   * a field initializer, so a gate declared below its first use is `undefined`
   * at construction time.
   */
  /**
   * ⚠️ **One call carrying both halves**, so Ranks (#E39) has one place to add
   * `requires:` and a page and an endpoint cannot disagree about which gates
   * apply.
   *
   * `requires: "deploy:manage"` because deploying into somebody's cloud
   * account is the most powerful act in Lore, and it is its own permission
   * rather than `app:manage` for the reason `sigil:manage` is its own: letting
   * somebody rename a copy is not letting them push code into an estate. On
   * nobody by default, so widening it is an owner creating a rank that carries
   * it. The capability option because a project that does not deploy through
   * Lore should not have the endpoint at all.
   */
  protected deployGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  /**
   * ⚠️ Reads do NOT take the capability. Disabling a capability hides it and
   * never deletes anything, so a project that turns `deploy` off must get an
   * empty tab rather than an error on the history it already has.
   */
  protected ownsProject = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  startDeploy = $action({
    use: [this.deployGate()],
    method: "POST",
    path: "/projects/:projectId/apps/:instanceId/deployments",
    description: "Deploy a stored build onto one deployed copy.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        instanceId: z.uuid(),
      }),
      body: z.object({
        /**
         * Which stored build. `latest` is the mutable tag and the default,
         * matching `ArtifactService.MUTABLE_TAG`.
         */
        tag: releaseTagSchema.default("latest"),
      }),
      response: z.object({
        id: z.uuid(),
        status: z.string(),
      }),
    },
    handler: async ({ params, body, user }) => {
      const row = await this.deploys.queue({
        projectId: params.projectId,
        instanceId: params.instanceId,
        tag: body.tag,
        createdBy: user?.id,
      });

      // ⚠️ Pushed rather than awaited. A deploy takes tens of seconds and this
      // request must answer immediately: inside the request it would be
      // cancelled when the client goes away, and the operator closing a tab
      // would abandon a half-uploaded Worker.
      await this.jobs.runDeploy.push(
        { deploymentId: row.id, stage: "deploy" },
        { key: DeployJobs.key(row.id) },
      );

      return { id: row.id, status: row.status };
    },
  });

  listDeployments = $action({
    use: [this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/apps/:instanceId/deployments",
    description: "What has been deployed to this copy, newest first.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        instanceId: z.uuid(),
      }),
      response: z.object({
        items: z.array(z.record(z.text(), z.any())),
      }),
    },
    handler: async ({ params }) => {
      const items = await this.deploys.list(
        params.projectId,
        params.instanceId,
      );
      return { items } as any;
    },
  });

  /**
   * What rolling back to this run would take, and what it would risk.
   *
   * A read, so it does not take the `deploy` capability - the Deploy tab shows
   * this before anybody asks for anything.
   */
  planDeploymentRollback = $action({
    use: [this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/deployments/:deploymentId/rollback",
    description: "What a rollback to this run would do.",
    schema: {
      params: z.object({ projectId: z.integer(), deploymentId: z.uuid() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) =>
      (await this.rollbacks.plan(params.projectId, params.deploymentId)) as any,
  });

  /**
   * Roll back to a version Cloudflare still holds.
   *
   * ⚠️ Takes the full deploy gate: pointing production at older code is a
   * deploy, whatever it costs to do.
   */
  /**
   * ⚠️ Named `rollbackDeployment`, not `rollback`. `$action` names are ONE
   * global namespace per container, so a second `rollback` anywhere is a boot
   * failure that reads as every test in the app breaking at once.
   */
  rollbackDeployment = $action({
    use: [this.deployGate()],
    method: "POST",
    path: "/projects/:projectId/deployments/:deploymentId/rollback",
    description: "Point this copy back at a version it ran before.",
    schema: {
      params: z.object({ projectId: z.integer(), deploymentId: z.uuid() }),
      body: z.object({
        /**
         * ⚠️ Required when migrations landed after the chosen version. The
         * database is not rolled back with the code, and the fast path invites
         * clicking precisely because it is cheap.
         */
        acknowledgeMigrations: z.boolean().optional(),
      }),
      response: okSchema,
    },
    handler: async ({ params, body }) => {
      await this.rollbacks.rollback(params.projectId, params.deploymentId, {
        acknowledgeMigrations: body.acknowledgeMigrations,
      });
      return { ok: true };
    },
  });

  /**
   * One run, with its log.
   *
   * Polled by the Deploy tab while a run is live. ⚠️ The log is bounded at
   * `DeployRegistry.MAX_LOG_LINES`, so this response has a ceiling and a
   * runaway deploy cannot make it unbounded.
   */
  getDeployment = $action({
    use: [this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/deployments/:deploymentId",
    description: "One deploy run, with its log.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        deploymentId: z.uuid(),
      }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) => {
      const row = await this.deploys.find(
        params.projectId,
        params.deploymentId,
      );
      if (!row) {
        throw new NotFoundError("No such deploy in this project.");
      }
      return row as any;
    },
  });
}

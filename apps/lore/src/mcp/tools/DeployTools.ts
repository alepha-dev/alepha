import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { AppController } from "../../api/controllers/AppController.ts";
import { DeployController } from "../../api/controllers/DeployController.ts";
import {
  deployRollbackParamsSchema,
  deployRollbackResultSchema,
  deployStartParamsSchema,
  deployStartResultSchema,
  deployStatusParamsSchema,
  deployStatusResultSchema,
} from "../schemas/index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * Shipping, from a conversation: what to deploy, deploy it, watch it, take it
 * back.
 *
 * ## ⚠️ There is no artifact tool here, and no estate tool anywhere
 *
 * `artifact_list` and `artifact_get` already ship in `ArtifactTools`, so
 * "list what is deployable" is answered and adding a third would be a
 * duplicate. **Estates are not a project resource**: an estate is owned by a
 * USER and lent to projects, `app_instance_list` already answers which one a
 * copy deploys to, and there is nothing an `estate_list` would add.
 *
 * That also settles the old warning cleanly. A credential grant was never to be
 * initiated from MCP, and now no MCP tool goes near one.
 *
 * ## ⚠️ No estate argument, ever
 *
 * An agent names a project, an app and an environment. The estate is resolved
 * server-side from the `app_instances` row, because an agent that could name an
 * estate could deploy into somebody else's cloud account. Folio #96 named that
 * hole and `DeployGate` is what keeps it shut.
 *
 * ## The descriptions are the interface
 *
 * Every refusal these tools surface is the server's own sentence, unedited: the
 * runtime gate names the build to produce, and the credential and kill-switch
 * clauses name whose estate it is. An agent that reports a status code instead
 * has thrown away the only actionable half.
 */
export class DeployTools {
  protected readonly deploys = $inject(DeployController);
  protected readonly apps = $inject(AppController);
  protected readonly projects = $inject(ProjectTools);

  /**
   * How much of a run's log a status answers with.
   *
   * The tail rather than the whole thing: a deploy log is written for a human
   * watching it happen, and an agent needs the end of it to say what went
   * wrong. `DeployRegistry` already bounds the stored log, so this is a second
   * bound over a bounded thing rather than the only one.
   */
  protected static readonly LOG_TAIL = 40;

  deploy_start = $tool({
    title: "Deploy a stored build",
    description:
      "Ship a build that has already been pushed onto one deployed copy. ⚠️ **Nothing here builds.** A tag with no stored artifact is refused rather than built, which is the point of having a registry: a build that passed staging on Tuesday must be the same bytes when it is promoted on Friday. Omitting the tag deploys `latest`, the one tag whose bytes may be replaced in place, so it promotes whatever was pushed last rather than a version somebody chose. There is deliberately no estate argument: where a copy deploys to is a property of the copy, and an agent that could name an estate could deploy into somebody else's cloud account. Project owner only. Answers immediately with a run id; follow it with `deploy_status`.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: deployStartParamsSchema,
      result: deployStartResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const instance = await this.instanceOf(projectId, params.app, params.env);

      // ⚠️ Every refusal is the server's - the runtime gate, the credential
      // clause, the missing artifact - and every one of them happens inside
      // this call, before any side effect.
      return await this.deploys.startDeploy({
        params: { projectId, instanceId: instance.id },
        body: { tag: params.tag ?? "latest" },
      });
    },
  });

  deploy_status = $tool({
    title: "Read a deploy",
    description:
      "Where a run got to, and the tail of its log. Name the run by its id, or name a copy by `app` and `env` to read its newest run. Poll this while the status is `queued` or `running`; `succeeded`, `failed` and `cancelled` are terminal. Readable by any project member, including when the project has turned deploys off - what already happened is history and stays visible.",
    annotations: { readOnlyHint: true },
    schema: {
      params: deployStatusParamsSchema,
      result: deployStatusResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );

      const row = params.deployment
        ? await this.deploys.getDeployment({
            params: { projectId, deploymentId: params.deployment },
          })
        : await this.newestRun(projectId, params.app, params.env);

      return {
        id: String(row.id),
        app: String(row.app),
        tag: String(row.tag),
        sha256: String(row.sha256),
        status: String(row.status),
        url: row.url ? String(row.url) : undefined,
        error: row.error ? String(row.error) : undefined,
        createdAt: String(row.createdAt),
        log: ((row.log ?? []) as Array<{ text: string }>)
          .slice(-DeployTools.LOG_TAIL)
          .map((line) => line.text),
      };
    },
  });

  deploy_rollback = $tool({
    title: "Roll a copy back",
    description:
      "Point a deployed copy back at something it ran before. Takes the fast path when Cloudflare still holds that version - seconds, no upload - and redeploys the stored build when it does not, saying which it did. ⚠️ **A rollback changes the code and not the database.** If migrations have landed since that run shipped, this refuses once and names how many; pass `acknowledge_migrations` to proceed knowing the old build will run against the current schema. Project owner only.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: deployRollbackParamsSchema,
      result: deployRollbackResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );

      // Asked first, so the answer says which mechanism ran rather than
      // leaving the agent to infer it - and so the artifact fallback is a
      // decision here rather than a silent substitution server-side.
      const plan = (await this.deploys.planDeploymentRollback({
        params: { projectId, deploymentId: params.deployment },
      })) as Record<string, any>;

      if (plan.path === "version") {
        await this.deploys.rollbackDeployment({
          params: { projectId, deploymentId: params.deployment },
          body: { acknowledgeMigrations: params.acknowledge_migrations },
        });
        return { path: "version" };
      }

      // ⚠️ The migration warning applies to BOTH paths, and the fast one
      // enforces it server-side. Redeploying an artifact goes through
      // `startDeploy`, which knows nothing about rollback, so the check has to
      // happen here or this path would silently skip it.
      const migrations = Number(plan.migrationsSince ?? 0);
      if (migrations > 0 && !params.acknowledge_migrations) {
        throw new BadRequestError(
          `${migrations} migration(s) have been applied since that build shipped. A rollback changes the code and not the database, so it would run against the current schema. Pass acknowledge_migrations to proceed.`,
        );
      }

      const deployment = plan.deployment as Record<string, any>;
      await this.deploys.startDeploy({
        params: {
          projectId,
          instanceId: String(deployment.instanceId),
        },
        body: { tag: String(deployment.tag) },
      });
      return { path: "artifact", reason: plan.reason };
    },
  });

  /**
   * The copy a pair names, or a refusal saying it does not exist.
   *
   * ⚠️ Refused, never created. Minting a deploy target as a side effect of a
   * typo in `env` is how `clbu` gets deployed to, and epic #30 accepted the
   * typo cost precisely because creation is always an explicit act.
   */
  protected async instanceOf(
    projectId: number,
    app: string | undefined,
    env: string | undefined,
  ): Promise<{ id: string }> {
    if (!app || !env) {
      throw new BadRequestError(
        "Name both an app and an environment, or a deployment id. `app_instance_list` returns the pairs this project has.",
      );
    }
    return await this.apps.getApp({ params: { projectId, app, env } });
  }

  /**
   * That copy's newest run.
   */
  protected async newestRun(
    projectId: number,
    app: string | undefined,
    env: string | undefined,
  ): Promise<Record<string, any>> {
    const instance = await this.instanceOf(projectId, app, env);
    const res = await this.deploys.listDeployments({
      params: { projectId, instanceId: instance.id },
    });
    const [newest] = res.items as Array<Record<string, any>>;
    if (!newest) {
      throw new NotFoundError(
        `${app}/${env} has never been deployed, so there is no run to read.`,
      );
    }
    return newest;
  }
}

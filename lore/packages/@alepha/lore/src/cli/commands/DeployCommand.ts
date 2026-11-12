import type { AppController, DeployController } from "@lore/deploy/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore deploy status` and `lore deploy rollback`: read a run, take it back.
 *
 * ```bash
 * lore deploy status --app acme --env production -p alepha
 * lore deploy rollback --deployment 0190... -p alepha
 * ```
 *
 * Children of `lore deploy`, which keeps its own handler: `CliProvider` walks
 * into a child only when the next word names one, so a bare `lore deploy
 * --env staging` still deploys.
 *
 * ⚠️ A rollback changes the code and not the database. With migrations landed
 * since that run, both paths refuse without `--acknowledge-migrations`.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class DeployCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly deployApi = $client<DeployController>(this.client.scope());
  protected readonly appApi = $client<AppController>(this.client.scope());

  /**
   * How much of a run's log `status` prints, the bound `deploy_status` keeps.
   */
  protected static readonly LOG_TAIL = 40;

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly status = $command({
    name: "status",
    description:
      "Where a run got to and the tail of its log: by --deployment, or a copy's newest by --app and --env",
    flags: z.object({
      ...DeployCommand.PROJECT_FLAG,
      deployment: z.uuid().describe("The run's id.").optional(),
      app: z.text({ description: "Instead of a run: which app." }).optional(),
      env: z
        .text({ aliases: ["e"], description: "Which copy of it." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const run = flags.deployment
          ? await this.deployApi.getDeployment({
              params: { projectId, deploymentId: flags.deployment },
            })
          : await this.newestRun(projectId, flags.app, flags.env);

        if (flags.output === "json") {
          this.render.json(print, run);
          return;
        }

        const log = ((run.log ?? []) as Array<{ text: string }>)
          .slice(-DeployCommand.LOG_TAIL)
          .map((line) => line.text);
        this.render.entity(print, {
          fields: [
            ["Deployment", String(run.id)],
            ["App", String(run.app)],
            ["Tag", String(run.tag)],
            ["Status", String(run.status)],
            ["Url", run.url ? String(run.url) : undefined],
            ["Error", run.error ? String(run.error) : undefined],
            ["Created", String(run.createdAt)],
          ],
          sections: log.length ? [{ title: "Log", lines: log }] : [],
        });
      });
    },
  });

  public readonly rollback = $command({
    name: "rollback",
    description:
      "Point a copy back at something it ran before: the code, never the database",
    flags: z.object({
      ...DeployCommand.PROJECT_FLAG,
      deployment: z.uuid().describe("The successful run to go back to."),
      "acknowledge-migrations": z
        .boolean()
        .describe(
          "Required when migrations landed since that run: the old build will run against the current schema.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const deploymentId = flags.deployment;
        const acknowledged = flags["acknowledge-migrations"];

        const plan = (await this.deployApi.planDeploymentRollback({
          params: { projectId, deploymentId },
        })) as Record<string, any>;

        if (plan.path === "version") {
          await this.deployApi.rollbackDeployment({
            params: { projectId, deploymentId },
            body: { acknowledgeMigrations: acknowledged },
          });
          this.render.written(
            print,
            flags.output,
            { path: "version" },
            `Rolled back to ${deploymentId}, on the version Cloudflare still holds`,
          );
          return;
        }

        // ⚠️ Redeploying the build goes through `startDeploy`, which knows
        // nothing about rollback, so the migration check is made here or this
        // path would skip it. The fast path is checked by the server.
        // `warning` is the server's sentence (#Q3542): from the schema check
        // when Lore could make one, from the migration count otherwise. A
        // Lore older than that sends only the count; a current one with a
        // count and no warning has a schema check that found it safe.
        const migrations = Number(plan.migrationsSince ?? 0);
        const warning =
          typeof plan.warning === "string"
            ? plan.warning
            : plan.schema || migrations === 0
              ? undefined
              : `${migrations} migration(s) have been applied since that build shipped. A rollback changes the code and not the database, so it would run against the current schema.`;
        if (warning && !acknowledged) {
          throw new UsageError(
            `${warning} Pass --acknowledge-migrations to proceed.`,
          );
        }

        const deployment = plan.deployment as Record<string, any>;
        await this.deployApi.startDeploy({
          params: { projectId, instanceId: String(deployment.instanceId) },
          body: { tag: String(deployment.tag) },
        });
        this.render.written(
          print,
          flags.output,
          { path: "artifact", reason: plan.reason },
          `Redeploying ${deployment.tag}, the stored build of ${deploymentId}. Follow it with lore deploy status`,
        );
      });
    },
  });

  /**
   * The newest run of a copy both halves of which were named.
   */
  protected async newestRun(
    projectId: number,
    app: string | undefined,
    env: string | undefined,
  ): Promise<Record<string, any>> {
    if (!app || !env) {
      throw new UsageError("Pass --deployment, or both --app and --env.");
    }
    const instance = await this.appApi.getApp({
      params: { projectId, app, env },
    });
    const { items } = await this.deployApi.listDeployments({
      params: { projectId, instanceId: instance.id },
    });
    const [newest] = items as Array<Record<string, any>>;
    if (!newest) {
      throw new UsageError(
        `${app}/${env} has never been deployed, so there is no run to read.`,
      );
    }
    return newest;
  }
}

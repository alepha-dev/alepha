import type { StackController, StackDeployController } from "@lore/deploy/api";
import { $inject, AlephaError, z } from "alepha";
import { $command, CommandError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";
import { LoreStackBundler } from "../services/LoreStackBundler.ts";
import { LoreStackService } from "../services/LoreStackService.ts";

/**
 * `lore stack`: apps and services deployed together from one compose.yml
 * (#E80, #Q2700), from a shell or CI, with or without Alepha Framework.
 *
 * The stack's name defaults to the project slug and never contains the
 * environment. `deploy` defaults to `production`; it uploads the compose
 * file as a new revision when given one, creates the environment on its first
 * deploy, and follows the deploy to its end, exiting non-zero when it fails.
 */
export class StackCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly stacks = $inject(LoreStackService);
  protected readonly bundler = $inject(LoreStackBundler);

  protected readonly stackApi = $client<StackController>(this.client.scope());
  protected readonly deployApi = $client<StackDeployController>(
    this.client.scope(),
  );

  protected readonly projectFlag = z
    .text({
      aliases: ["p"],
      description:
        "The project, by slug or id. Defaults to LORE_PROJECT, then .alepha/lore.json.",
    })
    .optional();
  protected readonly nameFlag = z
    .text({ description: "The stack's name. Defaults to the project slug." })
    .optional();

  public readonly create = $command({
    name: "create",
    description:
      "Create a stack, with its default estate, and upload its first revision",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      file: z
        .text({
          aliases: ["f"],
          description:
            "The compose file; the files it mounts beside it are bundled",
        })
        .optional(),
      estate: z
        .text({ description: "The estate its environments deploy to, by slug" })
        .optional(),
    }),
    handler: async ({ flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const name = await this.stacks.stackName(
          project,
          projectId,
          flags.name,
        );
        const estateId = flags.estate
          ? await this.stacks.estateId(projectId, flags.estate)
          : undefined;
        const bundle = flags.file
          ? await this.bundler.bundle(flags.file, root)
          : undefined;
        const stack = await this.stackApi.createStack({
          params: { projectId },
          body: { name, ...(estateId ? { estateId } : {}) },
        });
        print(
          `Created stack ${stack.name}${flags.estate ? `, deploying to ${flags.estate}` : ""}.`,
        );
        if (bundle) {
          const revision = await this.stackApi.uploadStackRevision({
            params: { projectId, stackId: stack.id },
            body: { file: bundle.file },
          });
          print(
            `Uploaded revision ${revision.number} (${bundle.paths.join(", ")}).`,
          );
        }
      });
    },
  });

  public readonly deploy = $command({
    name: "deploy",
    description:
      "Deploy the stack to an environment (production by default), uploading --file as a new revision first",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: z
        .text({
          aliases: ["e"],
          description:
            "The environment. Defaults to production; created on its first deploy.",
        })
        .optional(),
      file: z
        .text({
          aliases: ["f"],
          description:
            "Upload this compose file as a new revision before deploying",
        })
        .optional(),
      estate: z
        .text({
          description:
            "On an environment's first deploy: its estate, by slug, instead of the stack's default",
        })
        .optional(),
      revision: z
        .integer()
        .describe("Deploy this revision instead of the newest")
        .optional(),
      "dry-run": z
        .boolean()
        .describe("Say what would happen, and change nothing")
        .optional(),
    }),
    handler: async ({ flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const name = await this.stacks.stackName(
          project,
          projectId,
          flags.name,
        );
        const env = (flags.env ?? "production").trim().toLowerCase();
        let stack = await this.stacks.getStack(projectId, name);
        const bundle = flags.file
          ? await this.bundler.bundle(flags.file, root)
          : undefined;
        const existing = stack.environments.find((e) => e.env === env);

        if (flags["dry-run"]) {
          print(
            `Would deploy ${stack.name}/${env}${existing ? "" : " (a new environment)"}:`,
          );
          print(
            bundle
              ? `  upload ${bundle.paths.join(", ")} as revision ${(stack.latestRevision ?? 0) + 1}`
              : `  revision ${flags.revision ?? stack.latestRevision ?? "(none uploaded yet)"}`,
          );
          return;
        }

        if (bundle) {
          const revision = await this.stackApi.uploadStackRevision({
            params: { projectId, stackId: stack.id },
            body: { file: bundle.file },
          });
          print(`Uploaded revision ${revision.number}.`);
        }
        if (!existing) {
          const estateId = flags.estate
            ? await this.stacks.estateId(projectId, flags.estate)
            : undefined;
          await this.stackApi.createStackEnvironment({
            params: { projectId, stackId: stack.id },
            body: { env, ...(estateId ? { estateId } : {}) },
          });
          print(`Created environment ${stack.name}/${env}.`);
          stack = await this.stacks.getStack(projectId, name);
        }
        const environment = this.stacks.environmentOf(stack, env);
        const target = {
          projectId,
          stackId: stack.id,
          environmentId: environment.id,
        };
        const queued = await this.deployApi.deployStackEnvironment({
          params: target,
          body: flags.revision ? { revision: flags.revision } : {},
        });
        await this.finish(
          target,
          queued.id,
          queued.revision,
          `${stack.name}/${env}`,
          print,
        );
      });
    },
  });

  public readonly rollback = $command({
    name: "rollback",
    description:
      "Deploy an earlier revision to an environment again. Volumes and their data are untouched.",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: z.text({
        aliases: ["e"],
        description: "The environment to roll back",
      }),
      to: z.integer().describe("The revision to deploy again"),
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const stack = await this.stacks.getStack(
          projectId,
          await this.stacks.stackName(project, projectId, flags.name),
        );
        const environment = this.stacks.environmentOf(stack, flags.env);
        const target = {
          projectId,
          stackId: stack.id,
          environmentId: environment.id,
        };
        const queued = await this.deployApi.rollbackStackEnvironment({
          params: target,
          body: { revision: flags.to },
        });
        await this.finish(
          target,
          queued.id,
          queued.revision,
          `${stack.name}/${environment.env}`,
          print,
        );
      });
    },
  });

  public readonly destroy = $command({
    name: "destroy",
    description:
      "Forget an environment in Lore, and print the command that removes it from the machine",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: z.text({
        aliases: ["e"],
        description: "The environment to destroy",
      }),
      purge: z
        .boolean()
        .describe(
          "Also delete its volumes on the machine (the printed command carries --purge)",
        )
        .optional(),
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
    }),
    handler: async ({ flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const stack = await this.stacks.getStack(
          projectId,
          await this.stacks.stackName(project, projectId, flags.name),
        );
        const environment = this.stacks.environmentOf(stack, flags.env);
        const where = `${stack.name}/${environment.env}`;
        if (!flags.yes) {
          const confirmed = await ask.confirm(
            `Forget ${where} in Lore, its routes and variables included? Nothing on the machine changes until you run the printed command.`,
          );
          if (!confirmed) {
            throw new AlephaError("Not confirmed; nothing was changed.");
          }
        }
        await this.stackApi.deleteStackEnvironment({
          params: {
            projectId,
            stackId: stack.id,
            environmentId: environment.id,
          },
        });
        print(`Forgot ${where} in Lore.`);
        print("");
        print(
          "Removing it from the machine is not something Lore may ask over the connector. On the machine, run:",
        );
        print("");
        print(`  bay stack destroy ${where}${flags.purge ? " --purge" : ""}`);
      });
    },
  });

  public readonly list = $command({
    name: "list",
    description: "The project's stacks and their environments",
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.stackApi.listStacks({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }
        this.render.list(
          print,
          items.flatMap((stack) =>
            stack.environments.length === 0
              ? [
                  {
                    handle: stack.name,
                    title: "(no environment)",
                    fields: [`revision ${stack.latestRevision ?? "-"}`],
                  },
                ]
              : stack.environments.map((e) => ({
                  handle: `${stack.name}/${e.env}`,
                  title: e.revision
                    ? `runs revision ${e.revision}`
                    : "never deployed",
                  fields: [e.routes.map((r) => r.domain).join(", ")],
                })),
          ),
          undefined,
          "No stack yet. Create one with `lore stack create --file compose.yml --estate <estate>`.",
        );
      });
    },
  });

  public readonly revisions = $command({
    name: "revisions",
    description: "A stack's revisions, newest first",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const stack = await this.stacks.getStack(
          projectId,
          await this.stacks.stackName(project, projectId, flags.name),
        );
        const { items } = await this.stackApi.listStackRevisions({
          params: { projectId, stackId: stack.id },
        });
        if (flags.output === "json") {
          this.render.json(
            print,
            items.map(({ compose: _compose, model: _model, ...rest }) => rest),
          );
          return;
        }
        this.render.list(
          print,
          items.map((r) => ({
            handle: String(r.number),
            title: r.createdAt,
            fields: [r.sha256.slice(0, 12)],
          })),
          undefined,
          "No revision yet. Upload one with `lore stack deploy --file compose.yml`.",
        );
      });
    },
  });

  public readonly stack = $command({
    name: "stack",
    description:
      "Stacks: apps and services deployed together from one compose.yml",
    children: [
      this.create,
      this.deploy,
      this.rollback,
      this.destroy,
      this.list,
      this.revisions,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Follows a queued deploy, prints what the machine reported, and fails the
   * command when the deploy failed, so a CI step goes red.
   */
  protected async finish(
    target: { projectId: number; stackId: string; environmentId: string },
    deploymentId: string,
    revision: number,
    where: string,
    print: (line: string) => void,
  ): Promise<void> {
    print(`Deploying revision ${revision} to ${where}.`);
    const row = await this.stacks.follow(target, deploymentId, (line) =>
      print(`  ${line}`),
    );
    if (row.plan) {
      const plan = JSON.parse(row.plan) as {
        created?: string[];
        changed?: string[];
        removed?: string[];
      };
      for (const [label, list] of [
        ["created", plan.created],
        ["changed", plan.changed],
        ["removed", plan.removed],
      ] as const) {
        if (list?.length) {
          print(`  ${label}: ${list.join(", ")}`);
        }
      }
    }
    if (row.status === "failed") {
      throw new CommandError(
        `The deploy of ${where} failed: ${row.error ?? "the machine gave no reason"}`,
      );
    }
    print(`Deployed revision ${revision} to ${where}.`);
  }
}

import type {
  StackController,
  StackDeployController,
  StackVariableController,
} from "@lore/deploy/api";
import { $inject, AlephaError, z } from "alepha";
import { $command, CommandError, EnvUtils } from "alepha/command";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

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
  protected readonly variableApi = $client<StackVariableController>(
    this.client.scope(),
  );
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly envUtils = $inject(EnvUtils);

  /**
   * `--env` for the commands that write: required, never guessed, the rule
   * `lore secrets` follows. A variable set on the wrong environment is a
   * production secret in staging, or the reverse.
   */
  protected readonly requiredEnv = z.text({
    aliases: ["e"],
    description: "The environment. Required: it is never guessed.",
  });
  protected readonly optionalEnv = z
    .text({
      aliases: ["e"],
      description: "The environment. Defaults to production.",
    })
    .optional();

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

  // -------------------------------------------------------------------------
  // secrets, routes, services (#Q2701)
  // -------------------------------------------------------------------------

  public readonly secretsSet = $command({
    name: "set",
    description:
      "Set stack variables: KEY=VALUE, KEY to read $KEY, --file a dotenv file, or --generate random values",
    args: z
      .text({
        title: "KEY=VALUE",
        description:
          "KEY=VALUE, KEY alone (reads $KEY), or with --generate the key to generate. One per call; --file sets many.",
      })
      .optional(),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.requiredEnv,
      file: z
        .text({
          aliases: ["f"],
          description: "A dotenv file whose every key is set",
        })
        .optional(),
      generate: z
        .boolean()
        .describe("Generate a random value for each named key, on the server")
        .optional(),
      length: z
        .integer()
        .describe("With --generate: hex characters, 16 to 256 (default 64)")
        .optional(),
    }),
    handler: async ({ args, flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const words = args ? [args] : [];
        if (!words.length === !flags.file) {
          throw new AlephaError(
            "Pass KEY=VALUE (or KEY, or keys with --generate), or --file with a dotenv file. Not both, and not neither.",
          );
        }
        const target = await this.environmentTarget(flags);
        const sets: Array<{ key: string; value?: string; generate?: number }> =
          flags.file
            ? await this.readDotenv(root, flags.file)
            : words.map((word) =>
                flags.generate
                  ? { key: word, generate: flags.length ?? 64 }
                  : this.readPair(word),
              );
        for (const set of sets) {
          await this.variableApi.setStackVariable({
            params: target.params,
            body: set,
          });
          print(
            `Set ${set.key} on ${target.where}${set.generate ? " (generated)" : ""}.`,
          );
        }
        print("They apply on the environment's next deploy.");
      });
    },
  });

  public readonly secretsList = $command({
    name: "list",
    description:
      "A stack environment's variables: names and masks, never a value",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.requiredEnv,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget(flags);
        const { items } = await this.variableApi.listStackVariables({
          params: target.params,
        });
        if (items.length === 0) {
          print(`${target.where} has no variable.`);
          return;
        }
        for (const item of items) {
          print(
            `${item.key}  ${item.generated ? "(generated)" : item.valuePrefix ? `${item.valuePrefix}…` : "…"}`,
          );
        }
      });
    },
  });

  public readonly secretsUnset = $command({
    name: "unset",
    description: "Remove one variable from a stack environment",
    args: z.text({ title: "KEY", description: "The variable to remove" }),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.requiredEnv,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget(flags);
        await this.variableApi.removeStackVariable({
          params: target.params,
          query: { key: args },
        });
        print(`Removed ${args} from ${target.where}.`);
      });
    },
  });

  public readonly secrets = $command({
    name: "secrets",
    description: "A stack environment's variables: set, list, unset",
    children: [this.secretsSet, this.secretsList, this.secretsUnset],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly routeAdd = $command({
    name: "add",
    description: "Serve a full domain from one service of a stack environment",
    args: z.text({ title: "service", description: "The service that answers" }),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.requiredEnv,
      domain: z.text({
        aliases: ["d"],
        description: "The full domain, e.g. analytics.bob.dev",
      }),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const service = args;
        const domain = flags.domain;
        const target = await this.environmentTarget(flags);
        await this.stackApi.addStackRoute({
          params: target.params,
          body: { service, domain },
        });
        print(
          `${target.where} serves ${domain} from ${service}. It applies on the next deploy.`,
        );
      });
    },
  });

  public readonly routeList = $command({
    name: "list",
    description: "A stack environment's full-domain routes",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.optionalEnv,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget({
          ...flags,
          env: flags.env ?? "production",
        });
        const environment = target.environment;
        if (environment.routes.length === 0) {
          print(`${target.where} has no route.`);
          return;
        }
        for (const route of environment.routes) {
          print(`${route.domain}  ${route.service}`);
        }
      });
    },
  });

  public readonly routeRemove = $command({
    name: "remove",
    description: "Stop serving a full domain from a stack environment",
    args: z.text({
      title: "DOMAIN",
      description: "The domain to stop serving",
    }),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.requiredEnv,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget(flags);
        await this.stackApi.removeStackRoute({
          params: target.params,
          query: { domain: args },
        });
        print(
          `${target.where} no longer serves ${args}. It applies on the next deploy.`,
        );
      });
    },
  });

  public readonly route = $command({
    name: "route",
    description: "A stack environment's full-domain routes: add, list, remove",
    children: [this.routeAdd, this.routeList, this.routeRemove],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly ps = $command({
    name: "ps",
    description:
      "A stack environment's services: state, memory, restarts and the image digest it runs",
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.optionalEnv,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget({
          ...flags,
          env: flags.env ?? "production",
        });
        const view = await this.deployApi.listStackServices({
          params: target.params,
        });
        if (flags.output === "json") {
          this.render.json(print, view);
          return;
        }
        print(
          `${target.where}  ${view.revision ? `revision ${view.revision}` : "never deployed"}${view.stopped ? "  (stopped)" : ""}`,
        );
        for (const service of view.services) {
          const memory =
            service.memoryBytes === undefined
              ? ""
              : `${Math.round(service.memoryBytes / 1048576)} MiB`;
          print(
            `  ${service.name.padEnd(16)} ${service.kind.padEnd(8)} ${(service.state ?? "unreported").padEnd(12)} ${memory.padEnd(9)} ${service.restarts ?? ""}  ${service.digest ?? service.image ?? ""}`,
          );
        }
        for (const volume of view.volumes.filter((v) => v.backedUp === false)) {
          print(`  not backed up: volume ${volume.name}`);
        }
      });
    },
  });

  public readonly logs = $command({
    name: "logs",
    description: "The tail of one service's logs, asked of the machine",
    args: z.text({ title: "SERVICE", description: "The service" }),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.optionalEnv,
      lines: z
        .integer()
        .describe("How many lines, up to 2000 (default 200)")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget({
          ...flags,
          env: flags.env ?? "production",
        });
        const { request } = await this.deployApi.requestStackLogs({
          params: target.params,
          body: { service: args, lines: flags.lines ?? 200 },
        });
        const answer = await this.stacks.awaitLogs(target.params, request);
        if (answer.status !== "done") {
          throw new CommandError(
            `The machine could not answer: ${answer.reason ?? answer.status}`,
          );
        }
        for (const line of answer.lines ?? []) {
          print(line.raw);
        }
      });
    },
  });

  public readonly restart = $command({
    name: "restart",
    description: "Restart one service of a stack environment",
    args: z.text({ title: "SERVICE", description: "The service" }),
    flags: z.object({
      project: this.projectFlag,
      name: this.nameFlag,
      env: this.optionalEnv,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const target = await this.environmentTarget({
          ...flags,
          env: flags.env ?? "production",
        });
        await this.deployApi.stackServiceAction({
          params: { ...target.params, service: args, verb: "restart" },
        });
        print(`Asked ${target.where} to restart ${args}.`);
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
      this.secrets,
      this.route,
      this.ps,
      this.logs,
      this.restart,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The project, stack and environment a command names, resolved, with the
   * three ids the environment endpoints take and its name for messages.
   */
  protected async environmentTarget(flags: {
    project?: string;
    name?: string;
    env: string;
  }) {
    const context: LoreRefusalContext = {};
    const { project, projectId } = await this.projects.named(
      flags.project,
      context,
    );
    const stack = await this.stacks.getStack(
      projectId,
      await this.stacks.stackName(project, projectId, flags.name),
    );
    const environment = this.stacks.environmentOf(
      stack,
      flags.env.trim().toLowerCase(),
    );
    return {
      params: { projectId, stackId: stack.id, environmentId: environment.id },
      environment,
      where: `${stack.name}/${environment.env}`,
    };
  }

  /**
   * One KEY=VALUE, or KEY read from this process's environment. A value is
   * never printed, not even in the refusal.
   */
  protected readPair(word: string): { key: string; value: string } {
    const equals = word.indexOf("=");
    const key = (equals === -1 ? word : word.slice(0, equals)).trim();
    const value = equals === -1 ? process.env[key] : word.slice(equals + 1);
    if (!key) {
      throw new AlephaError(
        `"${word.slice(0, equals === -1 ? undefined : equals)}" names no key. Pass KEY=VALUE.`,
      );
    }
    if (!value) {
      throw new AlephaError(
        equals === -1
          ? `${key} is not set in this environment, so there is no value to send. Pass ${key}=VALUE, or export it first.`
          : `${key} has no value. Remove it with \`lore stack secrets unset ${key}\` instead.`,
      );
    }
    return { key, value };
  }

  protected async readDotenv(
    root: string,
    file: string,
  ): Promise<Array<{ key: string; value: string }>> {
    if (!(await this.fs.exists(this.fs.join(root, file)))) {
      throw new AlephaError(`${file} does not exist.`);
    }
    const vars = await this.envUtils.parseEnv(root, [file]);
    const pairs = Object.entries(vars).filter(
      ([, value]) => typeof value === "string" && value !== "",
    );
    if (pairs.length === 0) {
      throw new AlephaError(`${file} has no variable to set.`);
    }
    return pairs.map(([key, value]) => ({ key, value: String(value) }));
  }

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

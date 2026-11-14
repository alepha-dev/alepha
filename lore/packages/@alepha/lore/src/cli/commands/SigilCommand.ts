import type { AppController, SigilController } from "@lore/ship/api";
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
 * `lore sigil list | create | rotate | delete`: the credential one deployed
 * copy reports with.
 *
 * ```bash
 * lore sigil create --app acme --env staging -p alepha
 * lore sigil rotate 0190... -p alepha
 * ```
 *
 * ⚠️ The token `create` and `rotate` print is the only cleartext copy that will
 * ever exist: stdout carries it, and nothing can show it again.
 *
 * ⚠️ `delete` erases the copy's analytics, so it needs `--yes`. To revoke a
 * leaked token, `rotate`, which keeps every row.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class SigilCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly sigilApi = $client<SigilController>(this.client.scope());
  protected readonly appApi = $client<AppController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly ID_ARG = z.text({
    title: "id",
    description: "The sigil's id, as lore sigil list prints it.",
  });

  public readonly list = $command({
    name: "list",
    description:
      "Every credential in the project, with its deployed copy and when it last reported. Never a token",
    flags: z.object({
      ...SigilCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const { items } = await this.sigilApi.listSigils({
          params: { projectId },
        });

        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }

        this.render.list(
          print,
          items.map((sigil) => ({
            handle: sigil.id,
            title: sigil.name,
            fields: [sigil.tokenPrefix, sigil.lastSeenAt ?? "never reported"],
          })),
          undefined,
          "This project has no sigils.",
        );
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Mint the key one deployed copy reports with, creating the copy if it is missing. The token is shown once",
    flags: z.object({
      ...SigilCommand.PROJECT_FLAG,
      app: z.text({ description: "Which app to mint for." }),
      env: z
        .text({
          aliases: ["e"],
          description:
            "Which copy. Defaults to production: safe here, since a missing copy is created rather than guessed at.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { app } = flags;
        const env = flags.env ?? "production";

        // `createSigil` is 404 without a copy, so a missing one is created
        // first, as `sigil_create` does.
        const existing = await this.appApi
          .getApp({ params: { projectId, app, env } })
          .catch(() => undefined);
        if (!existing) {
          await this.appApi.createApp({
            params: { projectId },
            body: { app, env },
          });
        }

        const minted = await this.sigilApi.createSigil({
          params: { projectId },
          body: { app, env },
        });

        this.render.written(
          print,
          flags.output,
          { ...minted, app, env },
          `Created a sigil for ${app}/${env}. Its token, shown once: ${minted.token}`,
        );
      });
    },
  });

  public readonly rotate = $command({
    name: "rotate",
    description:
      "Revoke a sigil's token and mint a replacement, keeping everything it reported. The new token is shown once",
    args: SigilCommand.ID_ARG,
    flags: z.object({
      ...SigilCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const rotated = await this.sigilApi.rotateSigil({
          params: { projectId, sigilId: args },
        });

        this.render.written(
          print,
          flags.output,
          rotated,
          `Rotated ${rotated.name}. Its new token, shown once: ${rotated.token}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Remove a credential and everything it reported. The deployed copy survives, with no sigil",
    args: SigilCommand.ID_ARG,
    flags: z.object({
      ...SigilCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe(
          "Required: that copy's analytics go with it, and this cannot be undone. lore sigil rotate keeps them.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!flags.yes) {
          throw new UsageError(
            "Nothing deleted: this sigil's analytics would go for good, and lore sigil rotate revokes a token without that. Pass --yes to delete it.",
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.sigilApi.deleteSigil({
          params: { projectId, sigilId: args },
        });

        this.render.written(
          print,
          flags.output,
          result,
          `Deleted sigil ${args}`,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `sigil` would shadow this one
   * silently.
   */
  public readonly sigil = $command({
    name: "sigil",
    description:
      "The keys deployed copies report with: list, create, rotate and delete them",
    children: [this.list, this.create, this.rotate, this.delete],
    handler: async ({ help }) => {
      help();
    },
  });
}

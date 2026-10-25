import type { RegistryCredentialController } from "@lore/deploy/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore registry`: the project's container registry credentials (#Q2702),
 * what a company's private images are pulled with, by `lore artifacts
 * push-image` to verify them and by the estate at deploy.
 *
 * The secret goes one way: from stdin (`--password-stdin`, or `--password
 * @-`) to Lore, where it is sealed. It is never an argument, so it is never in
 * a shell history or a process list, and nothing prints it back.
 */
export class RegistryCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  protected readonly api = $client<RegistryCredentialController>(
    this.client.scope(),
  );

  protected readonly projectFlag = z
    .text({
      aliases: ["p"],
      description:
        "The project, by slug or id. Defaults to LORE_PROJECT, then .alepha/lore.json.",
    })
    .optional();

  public readonly add = $command({
    name: "add",
    description:
      "Store the project's credential for one registry host (the secret is read from stdin)",
    args: z.text({
      title: "host",
      description:
        "The registry host, as docker login takes it, e.g. registry.gitlab.com",
    }),
    flags: z.object({
      project: this.projectFlag,
      username: z.text({
        aliases: ["u"],
        description: "The registry username",
      }),
      "password-stdin": z
        .boolean()
        .describe("Read the token from stdin, as docker login does")
        .optional(),
      password: z
        .text({
          atFile: true,
          description:
            "The token, as @file or @- for stdin; never typed inline",
        })
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const secret = flags["password-stdin"]
          ? await this.readStdin()
          : flags.password;
        if (!secret?.trim()) {
          throw new AlephaError(
            "No token given. Pipe it in: `echo $TOKEN | lore registry add <host> -u <user> --password-stdin`.",
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);
        const stored = await this.api.setRegistryCredential({
          params: { projectId },
          body: { host: args, username: flags.username, secret: secret.trim() },
        });
        print(`Stored the credential for ${stored.host} (${stored.username}).`);
      });
    },
  });

  public readonly list = $command({
    name: "list",
    description:
      "The registries the project holds a credential for: hosts and usernames, never a secret",
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.api.listRegistryCredentials({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }
        this.render.list(
          print,
          items.map((item) => ({
            handle: item.host,
            title: item.username,
            fields: [`updated ${item.updatedAt}`],
          })),
          undefined,
          "No registry credential. Add one with `lore registry add <host> -u <user> --password-stdin`.",
        );
      });
    },
  });

  public readonly remove = $command({
    name: "remove",
    description: "Forget the project's credential for one registry host",
    args: z.text({ title: "host", description: "The registry host" }),
    flags: z.object({ project: this.projectFlag }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        await this.api.removeRegistryCredential({
          params: { projectId },
          query: { host: args },
        });
        print(`Removed the credential for ${args}.`);
      });
    },
  });

  public readonly registry = $command({
    name: "registry",
    description:
      "The project's container registry credentials: add, list, remove",
    children: [this.add, this.list, this.remove],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * All of stdin, as text. Protected so a spec substitutes it.
   */
  protected async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}

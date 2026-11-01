import type { DirectoryController } from "@lore/knowledge/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore directory list | create | rename | move | delete`: the folders of a
 * project's folios.
 *
 * ```bash
 * lore directory list -p alepha --directory 12
 * lore directory create "Decisions" -p alepha --parent 12
 * lore directory delete 12 -p alepha --cascade --yes
 * ```
 *
 * `directory_list` is `lore directory list`, so this is a subject of its own
 * rather than a child of `folio`.
 *
 * ⚠️ `--cascade` wipes the subtree: its folios, their attachments and the
 * directories under it.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class DirectoryCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly directoryApi = $client<DirectoryController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly REF_ARG = z.text({
    title: "ref",
    description:
      "The directory: 12 or D12, the number lore directory list prints.",
  });

  public readonly list = $command({
    name: "list",
    description: "List what a directory holds, or the project's root",
    flags: z.object({
      ...DirectoryCommand.PROJECT_FLAG,
      directory: z
        .text({
          description:
            "The directory to open: 12 or D12. Defaults to the root.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const parentId = await this.idOf(projectId, flags.directory);

        const contents = await this.directoryApi.listContents({
          params: { projectId },
          query: { parentId },
        });

        if (flags.output === "json") {
          this.render.json(print, contents);
          return;
        }

        const path = contents.breadcrumb.map((crumb) => crumb.name).join(" / ");
        if (path) {
          print(path);
        }
        this.render.list(
          print,
          contents.entries.map((entry) => ({
            handle: `${entry.kind === "folio" ? "F" : "D"}${entry.shortId}`,
            title: entry.name,
            fields: [entry.updatedAt.slice(0, 10)],
          })),
          undefined,
          "This directory is empty.",
        );
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description: "Create a directory; a name already taken gets a suffix",
    args: z.text({
      title: "name",
      maxLength: 200,
      description: "The directory's name.",
    }),
    flags: z.object({
      ...DirectoryCommand.PROJECT_FLAG,
      parent: z
        .text({
          description:
            "The directory to create it in: 12 or D12. Defaults to the root.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const created = await this.directoryApi.createDirectory({
          params: { projectId },
          body: {
            name: args,
            parentId: await this.idOf(projectId, flags.parent),
          },
        });

        this.render.written(
          print,
          flags.output,
          created,
          `Created D${created.shortId} ${created.name}`,
        );
      });
    },
  });

  public readonly rename = $command({
    name: "rename",
    description: "Rename a directory; a name already taken gets a suffix",
    args: DirectoryCommand.REF_ARG,
    flags: z.object({
      ...DirectoryCommand.PROJECT_FLAG,
      name: z.text({ maxLength: 200, description: "The new name." }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const updated = await this.directoryApi.renameDirectory({
          params: { id: (await this.idOf(projectId, args))! },
          body: { name: flags.name },
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `Renamed D${updated.shortId} to ${updated.name}`,
        );
      });
    },
  });

  public readonly move = $command({
    name: "move",
    description: "Move a directory under another, or to the root",
    args: DirectoryCommand.REF_ARG,
    flags: z.object({
      ...DirectoryCommand.PROJECT_FLAG,
      parent: z
        .text({
          description: "The new parent: 12 or D12. Defaults to the root.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const updated = await this.directoryApi.moveDirectory({
          params: { id: (await this.idOf(projectId, args))! },
          body: { parentId: await this.idOf(projectId, flags.parent) },
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `Moved D${updated.shortId} ${updated.name}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a directory; one that is not empty needs --cascade",
    args: DirectoryCommand.REF_ARG,
    flags: z.object({
      ...DirectoryCommand.PROJECT_FLAG,
      cascade: z
        .boolean()
        .describe(
          "Also delete what it holds: its folios, their attachments and its directories.",
        )
        .optional(),
      yes: z
        .boolean()
        .describe("Required: a delete cannot be undone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.directory(args);
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: D${shortId} would go for good. Pass --yes to delete it.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.directoryApi.deleteDirectory({
          params: { id: (await this.idOf(projectId, args))! },
          query: { cascade: flags.cascade },
        });

        this.render.written(print, flags.output, result, `Deleted D${shortId}`);
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `directory` would shadow this one
   * silently.
   */
  public readonly directory = $command({
    name: "directory",
    description:
      "The directories of a project's folios: list, create, rename, move and delete them",
    children: [this.list, this.create, this.rename, this.move, this.delete],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * A directory's id from a reference: `undefined` stays the root, and a
   * wrong number fails with nothing written.
   */
  protected async idOf(
    projectId: number,
    ref: string | undefined,
  ): Promise<string | undefined> {
    if (ref === undefined) return undefined;
    const directory = await this.directoryApi.getDirectoryByShortId({
      params: { projectId, shortId: this.refs.directory(ref) },
    });
    return directory.id;
  }
}

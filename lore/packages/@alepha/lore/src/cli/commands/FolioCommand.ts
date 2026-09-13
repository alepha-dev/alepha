import { $inject, z } from "alepha";
import { $command, CommandError } from "alepha/command";
import { $client } from "alepha/server/links";
import type { DirectoryController } from "lore/api/controllers/DirectoryController";
import type { EpicController } from "lore/api/controllers/EpicController";
import type { FolioController } from "lore/api/controllers/FolioController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore folio list | get | create`: a project's shared memory, from a shell.
 *
 * ```bash
 * lore folio list -p alepha --search "exit codes"
 * lore folio get F1264 -p alepha --links
 * lore folio create -p alepha --title "Lore CLI plan" --summary "The plan." --content @plan.md --epic 45
 * ```
 *
 * ## Deliberately not here
 *
 * - **`--directory` on `list`.** The list action has no directory filter; a
 *   directory's contents come from another action, in another shape.
 * - **`pinned` and `protected` on `create`.** A protected folio is encrypted
 *   in the browser, with a passphrase this process never sees.
 *
 * ⚠️ A protected folio's `content` is ciphertext. `get` says the folio is
 * protected and never prints it.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class FolioCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly folioApi = $client<FolioController>(this.client.scope());
  protected readonly directoryApi = $client<DirectoryController>(
    this.client.scope(),
  );
  protected readonly epicApi = $client<EpicController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description: "List a project's folios, pinned first, then newest-updated",
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      epic: z
        .text({
          description: "Only the folios filed under this epic: 45 or E45.",
        })
        .optional(),
      search: z
        .text({ description: "Only folios whose title or text contain this." })
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many folios to print, at most 100. Defaults to 20.")
        .default(20),
      offset: z
        .integer()
        .min(0)
        .describe("How many folios to skip, for the next page.")
        .default(0),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        // The list filters on the epic's global id, so a number is a lookup.
        const epic = flags.epic
          ? await this.epicApi.getEpicByNumber({
              params: { projectId, number: this.refs.epic(flags.epic) },
            })
          : undefined;

        const folios = await this.folioApi.list({
          query: {
            projectId,
            limit: flags.limit,
            offset: flags.offset,
            ...(flags.search ? { q: flags.search } : {}),
            ...(epic ? { epicId: epic.id } : {}),
          },
        });

        if (flags.output === "json") {
          this.render.json(print, folios);
          return;
        }

        this.render.list(
          print,
          folios.map((folio) => ({
            handle: `F${folio.shortId}`,
            title: folio.title,
            fields: [
              folio.pinned ? "pinned" : undefined,
              folio.updatedAt.slice(0, 10),
            ],
          })),
          { offset: flags.offset, limit: flags.limit },
          "No folios match.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description: "Show one folio: its summary and its Markdown content",
    args: z.text({
      title: "ref",
      description:
        "The folio: 12, F12 or '#F12'. Quote #F12: unquoted, a shell reads # as a comment.",
    }),
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      links: z
        .boolean()
        .describe("Also list what the folio references and what references it.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.folio(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const folio = await this.folioApi.getByShortId({
          params: { projectId, shortId },
          query: flags.links ? { withLinks: true } : {},
        });

        if (flags.output === "json") {
          this.render.json(print, folio);
          return;
        }

        const links = folio.metadata?.links;
        this.render.entity(print, {
          fields: [
            ["Folio", `F${folio.shortId}`],
            ["Title", folio.title],
            ["Summary", folio.summary],
            ["Updated", folio.updatedAt],
            ["Pinned", folio.pinned ? "yes" : undefined],
            ["Protected", folio.protected ? "yes" : undefined],
          ],
          body: folio.content,
          protected: folio.protected,
          sections: links
            ? [
                {
                  title: "References",
                  lines: links.outbound.length
                    ? links.outbound.map(
                        (link) =>
                          `${this.linkHandle(link.kind, link.shortId, link.tag)}  ${link.title}`,
                      )
                    : ["(none)"],
                },
                {
                  title: "Referenced by",
                  lines: links.inbound.length
                    ? links.inbound.map(
                        (link) =>
                          `${this.linkHandle(link.kind, link.shortId)}  ${link.title}`,
                      )
                    : ["(none)"],
                },
              ]
            : [],
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Create a folio, optionally in a directory and filed under an epic",
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      title: z.text({
        maxLength: 200,
        description: "The topic, in one line.",
      }),
      summary: z.text({
        maxLength: 500,
        description:
          "One or two sentences on what the folio is for: the line an index shows.",
      }),
      content: z.text({
        size: "rich",
        maxLength: 1_000_000,
        atFile: true,
        description: "The folio, in Markdown.",
      }),
      directory: z
        .integer()
        .min(1)
        .describe(
          "The directory to create it in, by its shortId. Defaults to the root.",
        )
        .optional(),
      epic: z
        .text({ description: "File it under this epic: 45 or E45." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        // Both reads before the write, so a wrong directory or epic number
        // fails with nothing written.
        const directory = flags.directory
          ? await this.directoryApi.getDirectoryByShortId({
              params: { projectId, shortId: flags.directory },
            })
          : undefined;
        const epic = flags.epic
          ? await this.epicApi.getEpicByNumber({
              params: { projectId, number: this.refs.epic(flags.epic) },
            })
          : undefined;

        const created = await this.folioApi.create({
          body: {
            projectId,
            title: flags.title,
            summary: flags.summary,
            content: flags.content,
            ...(directory ? { directoryId: directory.id } : {}),
          },
        });
        const line = `Created F${created.shortId} ${created.title}`;

        if (epic) {
          try {
            await this.epicApi.attachFolio({
              params: { id: epic.id },
              body: { folioId: created.id },
            });
          } catch (error) {
            this.printWrite(print, flags.output, created, line);
            throw new CommandError(
              `Created F${created.shortId}, but did not file it under E${epic.number}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error, exitCode: 1 },
            );
          }
        }

        this.printWrite(
          print,
          flags.output,
          created,
          epic ? `${line}, filed under E${epic.number}` : line,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `folio` would shadow this one
   * silently.
   */
  public readonly folio = $command({
    name: "folio",
    description:
      "A project's folios, its shared memory: list, read and create them",
    children: [this.list, this.get, this.create],
    handler: async ({ help }) => {
      help();
    },
  });

  protected printWrite(
    print: (message?: string) => void,
    output: string,
    subject: unknown,
    line: string,
  ): void {
    if (output === "json") {
      this.render.json(print, subject);
      return;
    }
    this.render.write(print, line);
  }

  /**
   * A link's handle in Lore's reference grammar: `F12`, `Q12`, `E3`, `P120`,
   * a release by its tag.
   */
  protected linkHandle(kind: string, shortId: number, tag?: string): string {
    const letters: Record<string, string> = {
      folio: "F",
      quest: "Q",
      epic: "E",
      feedback: "P",
      release: "R",
      comment: "C",
    };
    if (kind === "release" && tag) return tag;
    return `${letters[kind] ?? `${kind} `}${shortId}`;
  }
}

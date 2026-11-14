import type { EpicController } from "@lore/plan/api";
import type { DirectoryController } from "@lore/remember/api";
import type { FolioAttachmentController } from "@lore/remember/api";
import type { FolioController } from "@lore/remember/api";
import { $inject, z } from "alepha";
import { $command, CommandError, UsageError } from "alepha/command";
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
 * `lore folio list | search | get | create | update | history | revert |
 * delete | attachment list | rename | delete`: a project's shared memory, from
 * a shell.
 *
 * ```bash
 * lore folio list -p alepha --search "exit codes"
 * lore folio get F1264 -p alepha --links
 * lore folio create -p alepha --title "Lore CLI plan" --summary "The plan." --content @plan.md --epic 45
 * lore folio update F1264 -p alepha --content @plan.md --summary "The plan, revised."
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
  protected readonly attachmentApi = $client<FolioAttachmentController>(
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
      "The folio: 12, F12 or '#F12'. Quote #F12: unquoted, a shell reads # as a comment.",
  });

  protected static readonly ATTACHMENT_ARG = z.text({
    title: "ref",
    description:
      "The attachment: 12 or A12, the number lore folio attachment list prints.",
  });

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
    args: FolioCommand.REF_ARG,
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
      pinned: z
        .boolean()
        .describe(
          "Pin it: its whole content reaches every lore project context. Use sparingly.",
        )
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
            ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}),
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
              { exitCode: 1 },
              {
                message: `Created F${created.shortId}, but did not file it under E${epic.number}: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              },
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

  public readonly update = $command({
    name: "update",
    description:
      "Change a folio's title, summary, content, directory, pin or epic",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      title: z.text({ maxLength: 200, description: "A new title." }).optional(),
      summary: z
        .text({
          maxLength: 500,
          description: "A new summary: refresh it when the content moves on.",
        })
        .optional(),
      content: z
        .text({
          size: "rich",
          maxLength: 1_000_000,
          atFile: true,
          description: "New content, in Markdown. Replaces the old one.",
        })
        .optional(),
      directory: z
        .integer()
        .min(0)
        .describe("Move it into this directory, by its shortId; 0 is the root.")
        .optional(),
      pinned: z
        .boolean()
        .describe(
          "Pin it, or unpin it with --no-pinned. Pinned folios open lore project context.",
        )
        .optional(),
      epic: z
        .text({
          description: "File it under this epic, 45 or E45; 0 takes it out.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.folio(args);
        const changed = (
          [
            "title",
            "summary",
            "content",
            "directory",
            "pinned",
            "epic",
          ] as const
        ).filter((key) => flags[key] !== undefined);
        if (changed.length === 0) {
          throw new UsageError(
            "Nothing to update: pass at least one of --title, --summary, --content, --directory, --pinned or --epic.",
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const folio = await this.folioApi.getByShortId({
          params: { projectId, shortId },
          query: {},
        });

        const directoryId = flags.directory
          ? (
              await this.directoryApi.getDirectoryByShortId({
                params: { projectId, shortId: flags.directory },
              })
            ).id
          : flags.directory === 0
            ? null
            : undefined;

        // The epic first, as `folio_update` does: it is a separate call that
        // can be refused on its own, and a refusal here writes nothing else.
        if (flags.epic === "0") {
          if (folio.epicId != null) {
            await this.epicApi.detachFolio({
              params: { id: folio.epicId, folioId: folio.id },
            });
          }
        } else if (flags.epic !== undefined) {
          const epic = await this.epicApi.getEpicByNumber({
            params: { projectId, number: this.refs.epic(flags.epic) },
          });
          await this.epicApi.attachFolio({
            params: { id: epic.id },
            body: { folioId: folio.id },
          });
        }

        // An epic move alone is not an edit: no revision for it.
        const updated = changed.some((key) => key !== "epic")
          ? await this.folioApi.update({
              params: { id: folio.id },
              body: {
                title: flags.title,
                summary: flags.summary,
                content: flags.content,
                directoryId,
                pinned: flags.pinned,
              },
            })
          : folio;

        this.printWrite(
          print,
          flags.output,
          updated,
          `Updated F${shortId}: ${changed.join(", ")}`,
        );
      });
    },
  });

  public readonly search = $command({
    name: "search",
    description: "Search a project's folios, with a snippet around each match",
    args: z.text({ title: "query", description: "The text to look for." }),
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      limit: z
        .integer()
        .min(1)
        .max(50)
        .describe("How many folios to print, at most 50. Defaults to 10.")
        .default(10),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const folios = await this.folioApi.list({
          query: { projectId, q: args, limit: flags.limit },
        });

        if (flags.output === "json") {
          this.render.json(print, folios);
          return;
        }

        if (folios.length === 0) {
          print("No folios match.");
          return;
        }
        folios.forEach((folio, index) => {
          if (index > 0) print("");
          print(`F${folio.shortId}  ${folio.title}`);
          // A protected folio's content is ciphertext, never a snippet.
          if (!folio.protected) {
            print(this.snippet(folio.content, args));
          }
        });
      });
    },
  });

  public readonly history = $command({
    name: "history",
    description:
      "List a folio's revisions, newest first; --output json carries their content",
    args: FolioCommand.REF_ARG,
    flags: z.object({ ...FolioCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const id = await this.idOf(args, flags.project, context);

        const revisions = await this.folioApi.listHistory({ params: { id } });

        if (flags.output === "json") {
          this.render.json(print, revisions);
          return;
        }

        this.render.list(
          print,
          revisions.map((revision) => ({
            handle: revision.id,
            title: revision.titleSnapshot,
            fields: [revision.action, revision.at.slice(0, 16)],
          })),
          undefined,
          "This folio has no revisions.",
        );
      });
    },
  });

  public readonly revert = $command({
    name: "revert",
    description:
      "Put a folio back to a revision; what it replaces stays in the history",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      revision: z
        .uuid()
        .describe("The revision's id, from lore folio history."),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const id = await this.idOf(args, flags.project, context);

        const folio = await this.folioApi.revertHistory({
          params: { id, revisionId: flags.revision },
        });

        this.printWrite(
          print,
          flags.output,
          folio,
          `Reverted F${folio.shortId} ${folio.title}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a folio for good",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe("Required: a delete cannot be undone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.folio(args);
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: F${shortId} would go for good. Pass --yes to delete it.`,
          );
        }

        const id = await this.idOf(args, flags.project, context);
        const result = await this.folioApi.delete({ params: { id } });

        this.printWrite(print, flags.output, result, `Deleted F${shortId}`);
      });
    },
  });

  public readonly attachmentList = $command({
    name: "list",
    description: "List a folio's attachments",
    args: FolioCommand.REF_ARG,
    flags: z.object({ ...FolioCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const folioId = await this.idOf(args, flags.project, context);

        const attachments = await this.attachmentApi.listAttachments({
          params: { folioId },
        });

        if (flags.output === "json") {
          this.render.json(print, attachments);
          return;
        }

        this.render.list(
          print,
          attachments.map((attachment) => ({
            handle: `A${attachment.shortId}`,
            title: attachment.name,
            fields: [attachment.mimeType, `${attachment.size} bytes`],
          })),
          undefined,
          "This folio has no attachments.",
        );
      });
    },
  });

  public readonly attachmentRename = $command({
    name: "rename",
    description: "Rename a folio's attachment; a name taken gets a suffix",
    args: FolioCommand.ATTACHMENT_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      name: z.text({ maxLength: 200, description: "The new name." }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.attachment(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const attachment = await this.attachmentApi.getAttachmentByShortId({
          params: { projectId, shortId },
        });
        const updated = await this.attachmentApi.renameAttachment({
          params: { id: attachment.id },
          body: { name: flags.name },
        });

        this.printWrite(
          print,
          flags.output,
          updated,
          `Renamed A${shortId} to ${updated.name}`,
        );
      });
    },
  });

  public readonly attachmentDelete = $command({
    name: "delete",
    description: "Delete a folio's attachment and reclaim its storage",
    args: FolioCommand.ATTACHMENT_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe("Required: a delete cannot be undone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.attachment(args);
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: A${shortId} would go for good. Pass --yes to delete it.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const attachment = await this.attachmentApi.getAttachmentByShortId({
          params: { projectId, shortId },
        });
        const result = await this.attachmentApi.deleteAttachment({
          params: { id: attachment.id },
        });

        this.printWrite(print, flags.output, result, `Deleted A${shortId}`);
      });
    },
  });

  public readonly attachment = $command({
    name: "attachment",
    description:
      "A folio's files: list, rename and delete them. lore attachments push adds them",
    children: [
      this.attachmentList,
      this.attachmentRename,
      this.attachmentDelete,
    ],
    handler: async ({ help }) => {
      help();
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
      "A project's folios, its shared memory: list, search, read, create, update, revert and delete them",
    children: [
      this.list,
      this.search,
      this.get,
      this.create,
      this.update,
      this.history,
      this.revert,
      this.delete,
      this.attachment,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * A folio's id from a reference. Its project goes into `context` first, so
   * a refusal names it.
   */
  protected async idOf(
    ref: string,
    project: string | undefined,
    context: LoreRefusalContext,
  ): Promise<string> {
    const shortId = this.refs.folio(ref);
    const { projectId } = await this.projects.named(project, context);
    const folio = await this.folioApi.getByShortId({
      params: { projectId, shortId },
      query: {},
    });
    return folio.id;
  }

  /**
   * About a hundred characters either side of the first match, as
   * `folio_search` cuts it.
   */
  protected snippet(text: string, query: string): string {
    const radius = 100;
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return text.slice(0, 240);
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + query.length + radius);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }

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

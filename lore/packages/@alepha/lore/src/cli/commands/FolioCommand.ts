import type { EpicController } from "@lore/plan/api";
import type { DirectoryController } from "@lore/remember/api";
import type { FolioAttachmentController } from "@lore/remember/api";
import type { FolioController } from "@lore/remember/api";
import type { FolioTableController } from "@lore/remember/api";
import { $inject, z } from "alepha";
import { $command, CommandError, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { FolioCsv } from "../../csv/FolioCsv.ts";
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
 * lore folio create -p alepha --title Hosting --summary "Options." --type table --column Host:text --column Price:number
 * lore folio row add F12 -p alepha --rows '[{"Host":"Fly","Price":5}]'
 * lore folio row list F12 -p alepha --where '[{"column":"Price","from":1}]' --sort Price
 * lore folio import hosting.csv -p alepha --summary "Options."
 * lore folio export F12 -p alepha --csv > hosting.csv
 * ```
 *
 * A table folio's rows and columns (#E144): `row list | add | update |
 * delete`, `column set`, and CSV in and out through `@alepha/lore/csv`,
 * the module Lore's browser pages use, so a file exported by one imports
 * unchanged by the other. Columns are named, never ids.
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
  protected readonly tableApi = $client<FolioTableController>(
    this.client.scope(),
  );
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly csv = new FolioCsv();

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

        const table =
          folio.type !== "text"
            ? await this.tableApi.getFolioTable({ params: { id: folio.id } })
            : undefined;
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
          body: table ? this.tableText(table) : folio.content,
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
      content: z
        .text({
          size: "rich",
          maxLength: 1_000_000,
          atFile: true,
          description: "The folio, in Markdown. Required for a text folio.",
        })
        .optional(),
      type: z
        .enum(["text", "table", "calendar"])
        .describe(
          "text (the default); table: typed columns and rows, no content, shown as a grid; or calendar: the same rows shown as a month by a date column (Title and Date when no --column is given).",
        )
        .optional(),
      column: z
        .array(z.text())
        .describe(
          "A table's or a calendar's column, repeated in order: Name:type, Status:select:Todo|Done, Due:date:time. Types: text, number, checkbox, date, select, reference.",
        )
        .optional(),
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
        // A table and a calendar are both rows (#Q3717).
        const isTable = flags.type === "table" || flags.type === "calendar";
        if (!isTable && flags.content === undefined) {
          throw new UsageError(
            "--content is required for a text folio; a table (--type table) or a calendar (--type calendar) takes --column instead.",
          );
        }
        if (!isTable && flags.column?.length) {
          throw new UsageError("--column needs --type table or calendar.");
        }
        const columns = (flags.column ?? []).map((spec) =>
          this.parseColumn(spec),
        );
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
            ...(isTable
              ? { type: flags.type as "table" | "calendar", columns }
              : { content: flags.content }),
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
          query: { projectId, q: args, limit: flags.limit, withContent: true },
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
            print(this.snippet(folio.content ?? "", args));
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

  public readonly rowList = $command({
    name: "list",
    description:
      "List a table folio's rows: filtered, sorted, paged, cells by column name",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      where: z
        .text({
          atFile: true,
          description:
            'Conditions, a JSON array: [{"column":"Due","from":"2026-11-01","to":"2026-11-30"}]; also equals, contains, isEmpty. A date range sorted by that column is the agenda.',
        })
        .optional(),
      sort: z.text({ description: "The column to sort by." }).optional(),
      direction: z
        .enum(["asc", "desc"])
        .describe("asc (the default) or desc.")
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many rows to print, at most 100. Defaults to 20.")
        .default(20),
      offset: z
        .integer()
        .min(0)
        .describe("How many rows to skip, for the next page.")
        .default(0),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const where = flags.where
          ? (this.parseJson(flags.where, "--where") as never)
          : undefined;
        const id = await this.idOf(args, flags.project, context);
        const [table, page] = await Promise.all([
          this.tableApi.getFolioTable({ params: { id } }),
          this.tableApi.listFolioRows({
            params: { id },
            query: {
              where,
              sort: flags.sort,
              direction: flags.direction,
              limit: flags.limit,
              offset: flags.offset,
            },
          }),
        ]);
        if (flags.output === "json") {
          this.render.json(print, {
            total: page.total,
            rows: page.rows.map((row) => this.namedRow(table.columns, row)),
          });
          return;
        }
        print(
          this.tableText({ ...table, rows: page.rows, rowCount: page.total }),
        );
      });
    },
  });

  public readonly rowAdd = $command({
    name: "add",
    description:
      "Add 1 to 100 rows to a table folio, cells keyed by column name",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      rows: z.text({
        size: "rich",
        atFile: true,
        description:
          'The rows, a JSON array of cells by column name: [{"Host":"Fly","Price":5}]. @file reads a file, @- reads stdin.',
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const rows = this.parseJson(flags.rows, "--rows");
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new UsageError("--rows is a JSON array of at least one row.");
        }
        const id = await this.idOf(args, flags.project, context);
        const added: number[] = [];
        for (let i = 0; i < rows.length; i += 100) {
          const answer = await this.tableApi.addFolioRows({
            params: { id },
            body: {
              rows: rows
                .slice(i, i + 100)
                .map((cells) => ({ cells: cells as Record<string, unknown> })),
            },
          });
          added.push(...answer.rows.map((row) => row.number));
        }
        this.printWrite(
          print,
          flags.output,
          { numbers: added },
          `Added ${added.length} row${added.length === 1 ? "" : "s"}: ${added.join(", ")}`,
        );
      });
    },
  });

  public readonly rowUpdate = $command({
    name: "update",
    description:
      "Change some cells of one row of a table folio; the others stay as they are",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      row: z.integer().min(1).describe("The row's number."),
      cells: z.text({
        atFile: true,
        description:
          'The cells to write, by column name, as JSON: {"Status":"Done"}; null empties one.',
      }),
      version: z
        .integer()
        .min(0)
        .describe("Refuse the write if the row changed since this version.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const cells = this.parseJson(flags.cells, "--cells");
        if (!cells || typeof cells !== "object" || Array.isArray(cells)) {
          throw new UsageError("--cells is a JSON object of cells by name.");
        }
        const id = await this.idOf(args, flags.project, context);
        const answer = await this.tableApi.updateFolioRow({
          params: { id, number: flags.row },
          body: {
            cells: cells as Record<string, unknown>,
            version: flags.version,
          },
        });
        this.printWrite(
          print,
          flags.output,
          answer,
          `Updated row ${flags.row}${answer.replaced.length ? `, replacing ${answer.replaced.join(", ")}` : ""}`,
        );
      });
    },
  });

  public readonly rowDelete = $command({
    name: "delete",
    description: "Delete rows of a table folio by number",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      rows: z.text({ description: "The row numbers, comma-separated: 3,5,8." }),
      yes: z
        .boolean()
        .describe("Required: a delete cannot be undone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const numbers = flags.rows
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((n) => Number.isSafeInteger(n) && n > 0);
        if (numbers.length === 0) {
          throw new UsageError("--rows names no row number.");
        }
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: rows ${numbers.join(", ")} would go for good. Pass --yes to delete them.`,
          );
        }
        const id = await this.idOf(args, flags.project, context);
        const answer = await this.tableApi.deleteFolioRows({
          params: { id },
          body: { numbers },
        });
        this.printWrite(
          print,
          flags.output,
          answer,
          answer.deleted.length
            ? `Deleted rows ${answer.deleted.join(", ")}`
            : "No row deleted: none of those numbers holds one.",
        );
      });
    },
  });

  public readonly row = $command({
    name: "row",
    description:
      "A table folio's rows: list, add, update and delete them, by number",
    children: [this.rowList, this.rowAdd, this.rowUpdate, this.rowDelete],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly columnSet = $command({
    name: "set",
    description:
      "Change a table folio's columns with an ordered list of operations",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      operations: z.text({
        size: "rich",
        atFile: true,
        description:
          'The operations, a JSON array applied in order: [{"op":"add","name":"Due","type":"date"},{"op":"rename","column":"Name","name":"Title"},{"op":"retype","column":"Size","type":"number"},{"op":"move","column":"Due","position":0},{"op":"remove","column":"Old"},{"op":"setOptions","column":"Status","options":{"choices":["Todo","Done"]}}].',
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const operations = this.parseJson(flags.operations, "--operations");
        if (!Array.isArray(operations) || operations.length === 0) {
          throw new UsageError("--operations is a JSON array of operations.");
        }
        const id = await this.idOf(args, flags.project, context);
        const answer = await this.tableApi.setFolioColumns({
          params: { id },
          body: { operations: operations as never },
        });
        this.printWrite(
          print,
          flags.output,
          answer,
          `Columns: ${answer.columns.map((column) => `${column.name} (${column.type})`).join(", ")}`,
        );
      });
    },
  });

  public readonly column = $command({
    name: "column",
    description: "A table folio's columns: set them",
    children: [this.columnSet],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly import = $command({
    name: "import",
    description:
      "Create a table folio from a CSV file, or append its rows to one whose column names match",
    args: z.text({ title: "file", description: "The CSV file." }),
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      into: z
        .text({
          description:
            "Append to this table folio instead (12, F12): the header must name its columns.",
        })
        .optional(),
      title: z
        .text({
          maxLength: 200,
          description: "The new folio's title. Defaults to the file's name.",
        })
        .optional(),
      summary: z
        .text({ maxLength: 500, description: "The new folio's summary." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const path = args.startsWith("/")
          ? args
          : `${root.replace(/\/$/, "")}/${args}`;
        const text = new TextDecoder().decode(await this.fs.readFile(path));
        const { rows } = this.csv.parse(text);
        const [header, ...body] = rows;
        if (!header || header.length === 0) {
          throw new UsageError(`${args} has no header line.`);
        }
        if (body.length > 2000 || header.length > 50) {
          throw new UsageError(
            `${args} has ${body.length} rows and ${header.length} columns; a table holds at most 2000 rows and 50 columns.`,
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);

        let id: string;
        let shortId: number;
        if (flags.into) {
          shortId = this.refs.folio(flags.into);
          const folio = await this.folioApi.getByShortId({
            params: { projectId, shortId },
            query: {},
          });
          id = folio.id;
        } else {
          const columns = header.map((name, index) => {
            const values = body.map((row) => row[index] ?? "");
            const type = this.csv.guessType(values);
            return {
              name: name.trim() || `Column ${index + 1}`,
              type,
              ...(type === "date" && this.csv.hasTime(values)
                ? { options: { withTime: true } }
                : {}),
            };
          });
          const created = await this.folioApi.create({
            body: {
              projectId,
              title:
                flags.title ??
                (args.split("/").pop() ?? args).replace(/\.csv$/i, ""),
              summary: flags.summary,
              type: "table",
              columns,
            },
          });
          id = created.id;
          shortId = created.shortId;
        }

        const table = await this.tableApi.getFolioTable({ params: { id } });
        const known = new Map(
          table.columns.map((column) => [
            column.name.toLowerCase(),
            column.name,
          ]),
        );
        const matched = header.map((name) =>
          known.get(name.trim().toLowerCase()),
        );
        const skipped = header.filter((_, index) => !matched[index]);
        let added = 0;
        for (let i = 0; i < body.length; i += 100) {
          const batch = body.slice(i, i + 100).map((row) => {
            const cells: Record<string, string> = {};
            matched.forEach((name, index) => {
              if (name && (row[index] ?? "") !== "") cells[name] = row[index];
            });
            return { cells };
          });
          try {
            const answer = await this.tableApi.addFolioRows({
              params: { id },
              body: { rows: batch },
            });
            added += answer.rows.length;
          } catch (error) {
            throw new CommandError(
              { exitCode: 1 },
              {
                message: `Stopped at line ${i + 2} of ${args} (the batch starting there): ${error instanceof Error ? error.message : String(error)}. ${added} rows were imported before it, and stay.`,
                cause: error,
              },
            );
          }
        }
        this.printWrite(
          print,
          flags.output,
          { id, shortId, added, skipped },
          `Imported ${added} rows into F${shortId}${skipped.length ? `; skipped columns it has no name for: ${skipped.join(", ")}` : ""}`,
        );
      });
    },
  });

  public readonly export = $command({
    name: "export",
    description:
      "Print a table folio as CSV (--csv), every row in stored order, UTF-8 with a byte order mark",
    args: FolioCommand.REF_ARG,
    flags: z.object({
      ...FolioCommand.PROJECT_FLAG,
      csv: z
        .boolean()
        .describe("As CSV, the one format a table exports as today.")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!flags.csv) {
          throw new UsageError("Pass --csv: a table exports as CSV.");
        }
        const id = await this.idOf(args, flags.project, context);
        const { csv } = await this.tableApi.exportFolioTable({
          params: { id },
        });
        // `print` adds the line end the file already carries.
        print(csv.replace(/\r\n$/, ""));
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
      "A project's folios, its shared memory: list, search, read, create, update, revert and delete them; a table's rows and columns; CSV in and out",
    children: [
      this.list,
      this.search,
      this.get,
      this.create,
      this.update,
      this.history,
      this.revert,
      this.delete,
      this.row,
      this.column,
      this.import,
      this.export,
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

  /**
   * A `--column` spec: `Name:type`, `Status:select:Todo|Done`,
   * `Due:date:time`.
   */
  protected parseColumn(spec: string): {
    name: string;
    type: "text" | "number" | "checkbox" | "date" | "select" | "reference";
    options?: { choices?: string[]; withTime?: boolean };
  } {
    const [name, rawType = "text", extra] = spec.split(":");
    const types = [
      "text",
      "number",
      "checkbox",
      "date",
      "select",
      "reference",
    ] as const;
    const typed = types.find((type) => type === rawType.trim().toLowerCase());
    if (!name?.trim() || !typed) {
      throw new UsageError(
        `--column ${spec}: write Name:type, with type one of ${types.join(", ")}.`,
      );
    }
    if (typed === "select") {
      return {
        name: name.trim(),
        type: typed,
        options: {
          choices: (extra ?? "")
            .split("|")
            .map((label) => label.trim())
            .filter(Boolean),
        },
      };
    }
    if (typed === "date" && extra?.trim().toLowerCase() === "time") {
      return { name: name.trim(), type: typed, options: { withTime: true } };
    }
    return { name: name.trim(), type: typed };
  }

  protected parseJson(text: string, flag: string): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new UsageError(
        `${flag} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * A row with its cells keyed by column name, a select by its label.
   */
  protected namedRow(
    columns: Array<{
      id: string;
      name: string;
      type: string;
      options: { choices?: Array<{ id: string; label: string }> };
    }>,
    row: { number: number; version: number; cells: Record<string, unknown> },
  ) {
    const cells: Record<string, unknown> = {};
    for (const column of columns) {
      const value = row.cells[column.id] ?? null;
      cells[column.name] =
        column.type === "select" && value !== null
          ? (column.options.choices?.find((c) => c.id === value)?.label ?? null)
          : value;
    }
    return { number: row.number, version: row.version, cells };
  }

  /**
   * A table as plain text: a header, then one line per row, `#number` first,
   * cells separated by two spaces, empty cells as `-`.
   */
  protected tableText(table: {
    columns: Array<{
      id: string;
      name: string;
      type: string;
      options: { choices?: Array<{ id: string; label: string }> };
    }>;
    rows: Array<{
      number: number;
      version: number;
      cells: Record<string, unknown>;
    }>;
    rowCount: number;
  }): string {
    if (table.rows.length === 0) return "(no rows)";
    const lines = [
      ["#", ...table.columns.map((column) => column.name)].join("  "),
      ...table.rows.map((row) => {
        const named = this.namedRow(table.columns, row).cells;
        return [
          String(row.number),
          ...table.columns.map((column) => {
            const value = named[column.name];
            if (value === null || value === undefined) return "-";
            return typeof value === "object"
              ? JSON.stringify(value)
              : String(value as string | number | boolean);
          }),
        ].join("  ");
      }),
    ];
    if (table.rowCount > table.rows.length) {
      lines.push(`(${table.rows.length} of ${table.rowCount} rows)`);
    }
    return lines.join("\n");
  }
}

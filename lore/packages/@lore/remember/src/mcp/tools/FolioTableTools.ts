import { ProjectTools } from "@lore/core/mcp";
import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { FolioController } from "../../api/controllers/FolioController.ts";
import { FolioTableController } from "../../api/controllers/FolioTableController.ts";
import { folioColumnOperationSchema } from "../../api/schemas/folioColumnOperationSchema.ts";
import type { FolioColumnResource } from "../../api/schemas/folioColumnResourceSchema.ts";
import { folioRowFilterSchema } from "../../api/schemas/folioRowFilterSchema.ts";
import type { FolioRowResource } from "../../api/schemas/folioRowResourceSchema.ts";
import {
  folioCompactColumnSchema,
  folioCompactRowSchema,
  folioRefParamsSchema,
} from "../schemas/folioSchemas.ts";

/**
 * A table folio's rows and columns for an agent (#E144, #Q3515): change one
 * row without reading or rewriting the others.
 *
 * An agent names columns, never ids: every cell it sends is keyed by column
 * name (without regard to case), every row it reads comes back keyed by
 * name, a select by its label. An unknown name answers a 400 that lists the
 * table's columns.
 *
 * Each tool calls an action of `FolioTableController`, which the `lore` CLI
 * calls too (`lore folio row ...`, `lore folio column set`).
 */
export class FolioTableTools {
  protected readonly tables = $inject(FolioTableController);
  protected readonly folios = $inject(FolioController);
  protected readonly projectTools = $inject(ProjectTools);

  static readonly WHEN =
    "A table folio holds a list you will add to or change row by row; prose stays a text folio. A table with a date column also reads as a calendar.";

  folio_row_list = $tool({
    description: `List the rows of a table folio, filtered, sorted and paged, cells keyed by column name (a select by its label, a reference by its code). \`where\` holds conditions every row must pass: \`{ column, equals }\`, \`{ column, contains }\` (text, without regard to case), \`{ column, isEmpty: true }\`, or a range \`{ column, from, to }\` on a date or number column (inclusive; a day bound such as 2026-11-01 compares by day). A date range sorted by that column IS the table's agenda: \`where: [{ column: "Due", from: "2026-11-01", to: "2026-11-30" }], sort: "Due"\`. Answers \`total\` before paging. ${FolioTableTools.WHEN}`,
    title: "List table rows",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        where: z.array(folioRowFilterSchema).optional(),
        sort: z
          .string()
          .describe("The column to sort by, by name. Default: row order.")
          .optional(),
        direction: z.enum(["asc", "desc"]).optional(),
        limit: z.integer().min(1).max(100).default(20).optional(),
        offset: z.integer().min(0).optional(),
      }),
      result: z.object({
        total: z.integer(),
        rows: z.array(folioCompactRowSchema),
      }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const [table, page] = await Promise.all([
        this.tables.getFolioTable({ params: { id } }),
        this.tables.listFolioRows({
          params: { id },
          query: {
            where: params.where,
            sort: params.sort,
            direction: params.direction,
            limit: params.limit ?? 20,
            offset: params.offset ?? 0,
          },
        }),
      ]);
      return {
        total: page.total,
        rows: page.rows.map((row) => this.compactRow(table.columns, row)),
      };
    },
  });

  folio_row_add = $tool({
    description: `Add 1 to 100 rows to a table folio. Each row is its cells keyed by column name, e.g. \`{ "Name": "Fly.io", "Price": 5, "Due": "2026-11-20" }\`; a cell is coerced to its column's type and refused (nothing written) when it cannot be. Answers the new rows' numbers. ${FolioTableTools.WHEN}`,
    title: "Add table rows",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: folioRefParamsSchema.extend({
        rows: z.array(z.record(z.string(), z.any())).min(1).max(100),
      }),
      result: z.object({ numbers: z.array(z.integer()) }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const answer = await this.tables.addFolioRows({
        params: { id },
        body: { rows: params.rows.map((cells) => ({ cells })) },
      });
      return { numbers: answer.rows.map((row) => row.number) };
    },
  });

  folio_row_update = $tool({
    description:
      "Change some cells of one row of a table folio, by row number; the cells not named stay as they are, and `null` empties one. Pass the row's `version` (from folio_row_list or folio_get) to refuse the write if the row changed since you read it; without it the write replaces the cells named, and `replaced` says which held a value.",
    title: "Update a table row",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        row_number: z.integer().min(1),
        cells: z.record(z.string(), z.any()),
        version: z.integer().min(0).optional(),
      }),
      result: z.object({
        row: folioCompactRowSchema,
        replaced: z.array(z.string()),
      }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const [answer, table] = await Promise.all([
        this.tables.updateFolioRow({
          params: { id, number: params.row_number },
          body: { cells: params.cells, version: params.version },
        }),
        this.tables.getFolioTable({ params: { id } }),
      ]);
      return {
        row: this.compactRow(table.columns, answer.row),
        replaced: answer.replaced,
      };
    },
  });

  folio_row_delete = $tool({
    description:
      "Delete 1 to 100 rows of a table folio by number. A number no row holds is skipped; the answer lists the numbers deleted. A deleted row's number is never reused.",
    title: "Delete table rows",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        rows: z.array(z.integer().min(1)).min(1).max(100),
      }),
      result: z.object({ deleted: z.array(z.integer()) }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      return this.tables.deleteFolioRows({
        params: { id },
        body: { numbers: params.rows },
      });
    },
  });

  folio_column_set = $tool({
    description:
      'Change a table folio\'s columns with an ordered list of operations, applied one after the other: `{ op: "add", name, type, options? }`, `{ op: "rename", column, name }`, `{ op: "retype", column, type }`, `{ op: "move", column, position }` (0-based), `{ op: "remove", column }`, `{ op: "setOptions", column, options }`. Types: text, number, checkbox, date (`options.withTime` for a time), select (`options.choices`: labels), reference (#Q12, #F12). A column is named by its name. Retyping converts nothing: a cell that no longer fits reads as empty. Answers the columns as they stand.',
    title: "Change table columns",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        operations: z.array(folioColumnOperationSchema).min(1).max(50),
      }),
      result: z.object({ columns: z.array(folioCompactColumnSchema) }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const { columns } = await this.tables.setFolioColumns({
        params: { id },
        body: { operations: params.operations },
      });
      return { columns: columns.map((column) => this.compactColumn(column)) };
    },
  });

  /**
   * The table's columns and first rows as `folio_get` carries them.
   */
  public async tableView(id: string) {
    const table = await this.tables.getFolioTable({ params: { id } });
    return {
      columns: table.columns.map((column) => this.compactColumn(column)),
      rowCount: table.rowCount,
      rows: table.rows.map((row) => this.compactRow(table.columns, row)),
      truncated: table.rowCount > table.rows.length,
    };
  }

  /**
   * A row with its cells keyed by column name, a select by its label.
   */
  public compactRow(columns: FolioColumnResource[], row: FolioRowResource) {
    const cells: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      const value = row.cells[column.id] ?? null;
      cells[column.name] =
        column.type === "select" && value !== null
          ? (column.options.choices?.find((choice) => choice.id === value)
              ?.label ?? null)
          : value;
    }
    return { number: row.number, version: row.version, cells };
  }

  public compactColumn(column: FolioColumnResource) {
    return {
      name: column.name,
      type: column.type,
      ...(column.options.choices
        ? { choices: column.options.choices.map((choice) => choice.label) }
        : {}),
      ...(column.options.withTime ? { withTime: true } : {}),
    };
  }

  protected async resolveFolioId(params: {
    id?: string;
    shortId?: number;
    project?: number;
    project_name?: string;
  }): Promise<string> {
    if (params.id != null) return params.id;
    if (params.shortId == null) {
      throw new BadRequestError("Pass the folio's `id`, or its `shortId`.");
    }
    const projectId = await this.projectTools.resolveProjectId(
      params.project,
      params.project_name,
    );
    const id = await this.folios.idOfShortId(projectId, params.shortId);
    if (!id) throw new NotFoundError(`Folio #F${params.shortId} not found`);
    return id;
  }
}

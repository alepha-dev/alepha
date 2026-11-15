import { FolioCsv } from "@alepha/lore/csv";
import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository, DatabaseProvider } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { type Folio, folios } from "../entities/folios.ts";
import { folioColumnInputOptionsSchema } from "../schemas/folioColumnInputOptionsSchema.ts";
import { folioColumnOperationSchema } from "../schemas/folioColumnOperationSchema.ts";
import { folioColumnResourceSchema } from "../schemas/folioColumnResourceSchema.ts";
import { folioColumnTypeSchema } from "../schemas/folioColumnTypeSchema.ts";
import { folioIdParamsSchema } from "../schemas/folioIdParamsSchema.ts";
import { folioRowFilterSchema } from "../schemas/folioRowFilterSchema.ts";
import { folioRowResourceSchema } from "../schemas/folioRowResourceSchema.ts";
import { folioTableViewSchema } from "../schemas/folioTableViewSchema.ts";
import { FolioTableService } from "../services/FolioTableService.ts";

/**
 * A table folio's columns and rows over HTTP (#E144, #Q3512): what the
 * browser, the `lore` CLI and the MCP tools all call.
 *
 * It adds nothing to {@link FolioTableService} but the gate and the schemas.
 * Reads need `folio:read`, writes `folio:write` and the Remember capability,
 * through the same project gate `FolioController` uses. A row is addressed
 * by its `number` within the folio.
 *
 * Every write answers what it wrote, with the new `version`, and moves the
 * folio's `updatedAt` without touching `folios.version`: a row write must not
 * make a concurrent title edit answer 409.
 *
 * A pure controller: no hook, and injected by no service.
 */
export class FolioTableController {
  protected readonly folios = $repository(folios);
  protected readonly tables = $inject(FolioTableService);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly owned = $inject(OwnedResourceProvider);

  /**
   * The project gates, declared above the actions that read them.
   */
  protected ownsFolio = (requires: string) =>
    $ownsProject({ requires, repository: () => this.folios, param: "id" });

  protected ownsFolioForKnowledge = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.folios,
      param: "id",
      capability: "remember",
    });

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected readonly tableSchema = z.object({
    folioId: z.uuid(),
    columns: z.array(folioColumnResourceSchema),
    rowCount: z.integer(),
    rows: z.array(folioRowResourceSchema),
    /**
     * How the folio is read: grid or calendar, and the columns the
     * calendar uses (#Q3518).
     */
    view: folioTableViewSchema,
  });

  protected readonly listQuerySchema = z.object({
    /**
     * The conditions, all of which a row must pass.
     */
    where: z.array(folioRowFilterSchema).optional(),
    sort: z.string().optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    limit: z.integer().min(1).max(100).optional(),
    offset: z.integer().min(0).optional(),
  });

  protected readonly rowsAnswerSchema = z.object({
    rows: z.array(folioRowResourceSchema),
  });

  /**
   * How many rows {@link getFolioTable} carries.
   */
  static readonly FIRST_PAGE = 50;

  getFolioTable = $action({
    method: "GET",
    path: "/folios/:id/table",
    use: [this.ownsFolio("folio:read")],
    description:
      "A table folio's columns, its row count and its first page of rows.",
    schema: {
      params: folioIdParamsSchema,
      query: z.object({
        /**
         * How many rows to carry, up to a table's 2,000: the grid reads
         * them all (#Q3516), an agent the first 50.
         */
        limit: z.integer().min(1).max(2000).optional(),
      }),
      response: this.tableSchema,
    },
    handler: async ({ query }) =>
      this.tableOf(this.owned.get<Folio>(), query.limit),
  });

  getFolioTableByShortId = $action({
    method: "GET",
    path: "/projects/:projectId/folios/:shortId/table",
    use: [this.ownsProject("folio:read")],
    description:
      "A table folio's columns, row count and first rows, by its per-project shortId.",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: this.tableSchema,
    },
    handler: async ({ params }) => {
      const folio = await this.folios.findOne({
        where: {
          projectId: { eq: params.projectId },
          shortId: { eq: params.shortId },
        },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      return this.tableOf(folio);
    },
  });

  listFolioRows = $action({
    method: "GET",
    path: "/folios/:id/rows",
    use: [this.ownsFolio("folio:read")],
    description:
      "A table folio's rows: filtered, sorted and paged, with the total before paging.",
    schema: {
      params: folioIdParamsSchema,
      query: this.listQuerySchema,
      response: z.object({
        rows: z.array(folioRowResourceSchema),
        total: z.integer(),
      }),
    },
    handler: async ({ query }) => {
      const { rows, total } = await this.tables.listRows(
        this.owned.get<Folio>(),
        {
          where: query.where,
          sort: query.sort
            ? { column: query.sort, direction: query.direction }
            : undefined,
          limit: query.limit ?? 100,
          offset: query.offset ?? 0,
        },
      );
      return { rows, total };
    },
  });

  addFolioRows = $action({
    method: "POST",
    path: "/folios/:id/rows/add",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description:
      "Add 1 to 100 rows to a table folio, each after a row or at the bottom.",
    schema: {
      params: folioIdParamsSchema,
      body: z.object({
        rows: z
          .array(
            z.object({
              cells: z.record(z.text(), z.any()),
              after: z.integer().min(1).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      response: this.rowsAnswerSchema,
    },
    handler: async ({ body, user }) => {
      const folio = this.owned.get<Folio>();
      const rows = await this.tables.addRows(folio, body.rows, user.id);
      await this.touch(folio);
      return { rows };
    },
  });

  updateFolioRow = $action({
    method: "POST",
    path: "/folios/:id/rows/:number/update",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description:
      "Write some cells of one row of a table folio, against its version when given.",
    schema: {
      params: z.object({ id: z.uuid(), number: z.integer().min(1) }),
      body: z.object({
        cells: z.record(z.text(), z.any()),
        version: z.integer().min(0).optional(),
      }),
      response: z.object({
        row: folioRowResourceSchema,
        replaced: z.array(z.string()),
      }),
    },
    handler: async ({ params, body, user }) => {
      const folio = this.owned.get<Folio>();
      const answer = await this.tables.updateRow(
        folio,
        params.number,
        body.cells,
        { version: body.version, userId: user.id },
      );
      await this.touch(folio);
      return answer;
    },
  });

  moveFolioRow = $action({
    method: "POST",
    path: "/folios/:id/rows/:number/move",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description: "Move one row of a table folio before or after another.",
    schema: {
      params: z.object({ id: z.uuid(), number: z.integer().min(1) }),
      body: z.object({
        before: z.integer().min(1).optional(),
        after: z.integer().min(1).optional(),
      }),
      response: z.object({ row: folioRowResourceSchema }),
    },
    handler: async ({ params, body, user }) => {
      const folio = this.owned.get<Folio>();
      const row = await this.tables.moveRow(
        folio,
        params.number,
        body,
        user.id,
      );
      await this.touch(folio);
      return { row };
    },
  });

  deleteFolioRows = $action({
    method: "POST",
    path: "/folios/:id/rows/delete",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description:
      "Delete 1 to 100 rows of a table folio by number; numbers no row holds are skipped.",
    schema: {
      params: folioIdParamsSchema,
      body: z.object({
        numbers: z.array(z.integer().min(1)).min(1).max(100),
      }),
      response: z.object({ deleted: z.array(z.integer()) }),
    },
    handler: async ({ body, user }) => {
      const folio = this.owned.get<Folio>();
      const deleted = await this.tables.deleteRows(
        folio,
        body.numbers,
        user.id,
      );
      if (deleted.length) await this.touch(folio);
      return { deleted };
    },
  });

  setFolioColumns = $action({
    method: "POST",
    path: "/folios/:id/columns",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description:
      "Change a table folio's columns: add, rename, retype, move, remove, set options, applied in order.",
    schema: {
      params: folioIdParamsSchema,
      body: z.object({
        operations: z.array(folioColumnOperationSchema).min(1).max(50),
      }),
      response: z.object({ columns: z.array(folioColumnResourceSchema) }),
    },
    handler: async ({ body, user }) => {
      const folio = this.owned.get<Folio>();
      const columns = await this.tables.applyColumnOperations(
        folio,
        body.operations,
        user.id,
      );
      await this.touch(folio);
      return { columns };
    },
  });

  exportFolioTable = $action({
    method: "GET",
    path: "/folios/:id/table/csv",
    use: [this.ownsFolio("folio:read")],
    description:
      "A table folio as CSV: every row in position order, a header line, each cell as stored (a select by its label, a reference by its code, a date as ISO, a checkbox as true or false). UTF-8 with a byte order mark.",
    schema: {
      params: folioIdParamsSchema,
      response: z.object({ csv: z.string(), rowCount: z.integer() }),
    },
    handler: async () => {
      const folio = this.owned.get<Folio>();
      const { columns, rows, total } = await this.tables.listRows(folio);
      return {
        csv: this.csv.fromTable({
          columns: columns.map((column) => this.tables.columnResource(column)),
          rows,
        }),
        rowCount: total,
      };
    },
  });

  protected readonly csv = new FolioCsv();

  setFolioView = $action({
    method: "POST",
    path: "/folios/:id/view",
    use: [this.ownsFolioForKnowledge("folio:write")],
    description:
      "Remember the columns a calendar folio reads: the date column it lays rows out by, and the column that titles an entry. Grid or calendar is the folio's type, set at creation.",
    schema: {
      params: folioIdParamsSchema,
      body: z.object({
        dateColumnId: z.string().optional(),
        titleColumnId: z.string().optional(),
      }),
      response: folioTableViewSchema,
    },
    handler: async ({ body }) =>
      this.tables.setView(this.owned.get<Folio>(), body),
  });

  previewFolioColumnRetype = $action({
    method: "GET",
    path: "/folios/:id/columns/:column/retype-preview",
    use: [this.ownsFolio("folio:read")],
    description:
      "How many non-empty cells of a column would read as empty under another type: what a person is told before retyping.",
    schema: {
      params: z.object({ id: z.uuid(), column: z.string() }),
      query: z.object({
        type: folioColumnTypeSchema,
        withTime: z.boolean().optional(),
      }),
      response: z.object({ lost: z.integer() }),
    },
    handler: async ({ params, query }) => ({
      lost: await this.tables.cellsLostByRetype(
        this.owned.get<Folio>(),
        params.column,
        query.type,
        query.withTime === undefined
          ? undefined
          : folioColumnInputOptionsSchema.parse({ withTime: query.withTime }),
      ),
    }),
  });

  /**
   * The table's columns, its row count and its first rows.
   */
  protected async tableOf(folio: Folio, limit?: number) {
    const { columns, rows, total } = await this.tables.listRows(folio, {
      limit: limit ?? FolioTableController.FIRST_PAGE,
    });
    return {
      folioId: folio.id,
      columns: columns.map((column) => this.tables.columnResource(column)),
      rowCount: total,
      rows,
      view: await this.tables.viewOf(folio, columns),
    };
  }

  /**
   * Move the folio's `updatedAt`, and only that: the tree, recent folios and
   * the activity feed sort on it, and `folios.version` guards title and
   * summary edits, which a row write must not refuse.
   */
  protected async touch(folio: Folio): Promise<void> {
    await this.database.atomicBatch([
      this.folios.updateStatement(
        { id: { eq: folio.id } },
        {},
        { version: false, returning: false },
      ),
    ]);
  }
}

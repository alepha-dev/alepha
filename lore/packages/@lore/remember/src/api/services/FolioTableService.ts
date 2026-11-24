import {
  BoundParameters,
  ResourceLinkService,
  ResourceRegistry,
} from "@lore/core/api";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository, $sequence, DatabaseProvider } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type FolioColumn, folioColumns } from "../entities/folioColumns.ts";
import { type FolioRowRecord, folioRows } from "../entities/folioRows.ts";
import { folios } from "../entities/folios.ts";
import { folioViews } from "../entities/folioViews.ts";
import type { FolioCellValue } from "../schemas/folioCellValueSchema.ts";
import type { FolioColumnInputOptions } from "../schemas/folioColumnInputOptionsSchema.ts";
import type { FolioColumnOperation } from "../schemas/folioColumnOperationSchema.ts";
import type { FolioColumnResource } from "../schemas/folioColumnResourceSchema.ts";
import type { FolioColumnType } from "../schemas/folioColumnTypeSchema.ts";
import type { FolioRowFilter } from "../schemas/folioRowFilterSchema.ts";
import type { FolioRowResource } from "../schemas/folioRowResourceSchema.ts";
import type { FolioTableView } from "../schemas/folioTableViewSchema.ts";
import { FolioCellCodec } from "./FolioCellCodec.ts";
import { FolioHistoryService } from "./FolioHistoryService.ts";
import { FolioSearchTerms } from "./FolioSearchTerms.ts";

/**
 * The folio a table operation acts on: enough of the row to check that it is
 * a table and to resolve references in its project.
 */
export interface FolioTableTarget {
  id: string;
  projectId: number;
  type: string;
  /**
   * What a revision of the write records beside the table. A write that
   * carries an author and these is recorded in the folio's history.
   */
  title?: string;
  summary?: string;
}

/**
 * A table as a revision snapshot stores it, in `contentSnapshot` (#Q3513):
 * versioned, read leniently by {@link FolioTableService.decodeSnapshot}.
 */
export interface FolioTableSnapshotData {
  v: 1;
  columns: Array<{
    id: string;
    position: number;
    name: string;
    type: string;
    options: Record<string, unknown>;
  }>;
  rows: Array<{
    id: string;
    number: number;
    position: number;
    cells: Record<string, unknown>;
  }>;
}

/**
 * One row to add: its cells keyed by column id or name, and where it goes
 * (after the row with that number; at the bottom when omitted).
 */
export interface FolioRowInput {
  cells: Record<string, unknown>;
  after?: number;
}

/**
 * A query over a table's rows.
 */
export interface FolioRowQuery {
  where?: FolioRowFilter[];
  sort?: { column: string; direction?: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

/**
 * The folio's columns and rows as `FolioTableService.snapshot` reads them,
 * raw, for history and duplication.
 */
export interface FolioTableSnapshot {
  columns: FolioColumn[];
  rows: FolioRowRecord[];
}

/**
 * Owns a table folio's columns and rows (#E144, #Q3511): every write and
 * every read of them goes through here, and the controller, the MCP tools
 * and the CLI add only their gate and their schemas.
 *
 * Filtering and sorting run here over the folio's rows, never in SQL:
 * `cells` is JSON, and the query has to behave the same on SQLite, D1 and
 * Postgres. A table holds at most {@link MAX_ROWS} rows, so one read of them
 * all is bounded.
 */
export class FolioTableService {
  static readonly MAX_COLUMNS = 50;
  static readonly MAX_ROWS = 2000;
  static readonly MAX_CHOICES = 50;
  static readonly MAX_BATCH = 100;
  static readonly MAX_CHOICE_LABEL = 100;
  /**
   * The largest snapshot a revision stores, in UTF-8 bytes: under D1's
   * 2 MB limit on one value, with room for the row around it. A table past
   * it is recorded as too large to snapshot (it reads as "this revision
   * cannot be displayed") rather than failing the write that opened the
   * revision.
   */
  static readonly MAX_SNAPSHOT_BYTES = 1_800_000;
  /**
   * The most a table's cells may weigh, as JSON (#Q3708): under
   * `MAX_SNAPSHOT_BYTES` with room for the columns, so every revision can
   * snapshot the table. A write past it is refused only when it grows the
   * table, so an over-budget table can always be trimmed back.
   */
  static readonly MAX_TABLE_BYTES = 1_500_000;

  protected readonly columns = $repository(folioColumns);
  protected readonly rows = $repository(folioRows);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly codec = $inject(FolioCellCodec);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly history = $inject(FolioHistoryService);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly bound = $inject(BoundParameters);
  protected readonly searchTerms = $inject(FolioSearchTerms);
  protected readonly folios = $repository(folios);
  protected readonly views = $repository(folioViews);

  /**
   * Per-folio row numbers. A `$sequence` counter is keyed on this property
   * name, globally, so the name must stay distinct from every other
   * sequence (`folioShortId` numbers the folios themselves).
   */
  protected readonly folioRowNumber = $sequence();

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Refuse anything but a folio of rows (a table or a calendar, #Q3717),
   * with a message that says so.
   */
  public assertTable(folio: FolioTableTarget): void {
    if (folio.type === "text") {
      throw new BadRequestError(
        "This folio is not a table: its body is Markdown. Use the folio's content instead.",
      );
    }
  }

  /**
   * The folio's columns, left to right.
   */
  public async columnsOf(folioId: string): Promise<FolioColumn[]> {
    return this.columns.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "createdAt", direction: "asc" },
      ],
    });
  }

  /**
   * A column as the API answers it.
   */
  public columnResource(column: FolioColumn): FolioColumnResource {
    return {
      id: column.id,
      position: column.position,
      name: column.name,
      type: this.codec.typeOf(column),
      options: this.codec.optionsOf(column),
    };
  }

  /**
   * A row as the API answers it: every column of the table keyed, each cell
   * read leniently, removed columns' keys left out.
   */
  public rowResource(
    columns: FolioColumn[],
    row: FolioRowRecord,
  ): FolioRowResource {
    return {
      id: row.id,
      number: row.number,
      position: row.position,
      version: row.version,
      cells: this.readCells(columns, row.cells),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    };
  }

  /**
   * How many rows the folio holds.
   */
  public async rowCount(folioId: string): Promise<number> {
    return this.rows.count({ folioId: { eq: folioId } });
  }

  /**
   * The rows a query selects, and how many it selects before paging.
   * Position order unless a sort is given; an empty cell sorts last in
   * either direction, and ties keep position order.
   */
  public async listRows(
    folio: FolioTableTarget,
    query: FolioRowQuery = {},
  ): Promise<{
    columns: FolioColumn[];
    rows: FolioRowResource[];
    total: number;
  }> {
    this.assertTable(folio);
    const [columns, stored] = await Promise.all([
      this.columnsOf(folio.id),
      this.allRows(folio.id),
    ]);
    let rows = stored.map((row) => this.rowResource(columns, row));

    for (const filter of query.where ?? []) {
      const column = this.resolveColumn(columns, filter.column);
      rows = rows.filter((row) =>
        this.matches(column, row.cells[column.id] ?? null, filter),
      );
    }

    if (query.sort) {
      const column = this.resolveColumn(columns, query.sort.column);
      const flip = query.sort.direction === "desc" ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const left = a.cells[column.id] ?? null;
        const right = b.cells[column.id] ?? null;
        if (left === null && right === null) return a.position - b.position;
        if (left === null) return 1;
        if (right === null) return -1;
        return (
          flip * this.codec.compare(column, left, right) ||
          a.position - b.position
        );
      });
    }

    const total = rows.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? FolioTableService.MAX_ROWS;
    return { columns, rows: rows.slice(offset, offset + limit), total };
  }

  /**
   * The folio's columns and rows as stored, for a snapshot or a copy.
   */
  public async snapshot(folioId: string): Promise<FolioTableSnapshot> {
    const [columns, rows] = await Promise.all([
      this.columnsOf(folioId),
      this.allRows(folioId),
    ]);
    return { columns, rows };
  }

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  /**
   * Apply a list of column operations in order, and answer the columns as
   * they stand after the last. Each operation is checked against the state
   * the previous ones left, and writes before the next is checked: there is
   * no transaction on D1, so a refusal halfway leaves the earlier ones
   * applied, and the message names the operation refused.
   */
  protected async writeApplyColumnOperations(
    folio: FolioTableTarget,
    operations: FolioColumnOperation[],
  ): Promise<FolioColumnResource[]> {
    this.assertTable(folio);
    let columns = await this.columnsOf(folio.id);
    let reindex = false;
    for (const [index, operation] of operations.entries()) {
      const label = `Column operation ${index + 1} (${operation.op})`;
      try {
        switch (operation.op) {
          case "add":
            columns = await this.addColumn(folio.id, columns, operation);
            break;
          case "rename":
            columns = await this.renameColumn(
              columns,
              this.resolveColumn(columns, operation.column),
              operation.name,
            );
            break;
          case "retype":
            columns = await this.retypeColumn(
              columns,
              this.resolveColumn(columns, operation.column),
              operation.type,
              operation.options,
            );
            reindex = true;
            break;
          case "move":
            columns = await this.moveColumn(
              columns,
              this.resolveColumn(columns, operation.column),
              operation.position,
            );
            break;
          case "remove": {
            const column = this.resolveColumn(columns, operation.column);
            await this.columns.deleteById(column.id);
            columns = columns.filter((it) => it.id !== column.id);
            reindex = true;
            break;
          }
          case "setOptions":
            columns = await this.setColumnOptions(
              columns,
              this.resolveColumn(columns, operation.column),
              operation.options,
            );
            reindex = true;
            break;
        }
      } catch (error) {
        if (error instanceof BadRequestError && operations.length > 1) {
          throw new BadRequestError(`${label}: ${error.message}`);
        }
        throw error;
      }
    }
    if (reindex) await this.reindex(folio.id, columns);
    return columns.map((column) => this.columnResource(column));
  }

  /**
   * How many non-empty cells of a column would read as empty under another
   * type: what a person is told before retyping.
   */
  public async cellsLostByRetype(
    folio: FolioTableTarget,
    columnRef: string,
    type: FolioColumnType,
    options?: FolioColumnInputOptions,
  ): Promise<number> {
    this.assertTable(folio);
    const [columns, rows] = await Promise.all([
      this.columnsOf(folio.id),
      this.allRows(folio.id),
    ]);
    const column = this.resolveColumn(columns, columnRef);
    const next = {
      type,
      options: this.normalizeOptions(
        type,
        options,
        this.codec.optionsOf(column),
      ),
    };
    return rows.filter(
      (row) =>
        this.codec.read(column, row.cells[column.id]) !== null &&
        this.codec.read(next, row.cells[column.id]) === null,
    ).length;
  }

  protected async addColumn(
    folioId: string,
    columns: FolioColumn[],
    input: {
      name: string;
      type: FolioColumnType;
      options?: FolioColumnInputOptions;
      position?: number;
    },
  ): Promise<FolioColumn[]> {
    if (columns.length >= FolioTableService.MAX_COLUMNS) {
      throw new BadRequestError(
        `A table holds at most ${FolioTableService.MAX_COLUMNS} columns, and this one has ${columns.length}.`,
      );
    }
    const name = this.checkName(columns, input.name);
    const created = await this.columns.create({
      folioId,
      position: columns.length,
      name,
      lowerName: name.toLowerCase(),
      type: input.type,
      options: this.normalizeOptions(input.type, input.options),
    });
    const next = [...columns, created];
    return input.position === undefined || input.position >= columns.length
      ? next
      : this.moveColumn(next, created, input.position);
  }

  protected async renameColumn(
    columns: FolioColumn[],
    column: FolioColumn,
    name: string,
  ): Promise<FolioColumn[]> {
    const checked = this.checkName(
      columns.filter((it) => it.id !== column.id),
      name,
    );
    const updated = await this.columns.updateById(column.id, {
      name: checked,
      lowerName: checked.toLowerCase(),
    });
    return columns.map((it) => (it.id === column.id ? updated : it));
  }

  protected async retypeColumn(
    columns: FolioColumn[],
    column: FolioColumn,
    type: FolioColumnType,
    options?: FolioColumnInputOptions,
  ): Promise<FolioColumn[]> {
    const updated = await this.columns.updateById(column.id, {
      type,
      options: this.normalizeOptions(
        type,
        options,
        this.codec.optionsOf(column),
      ),
    });
    return columns.map((it) => (it.id === column.id ? updated : it));
  }

  protected async setColumnOptions(
    columns: FolioColumn[],
    column: FolioColumn,
    options: FolioColumnInputOptions,
  ): Promise<FolioColumn[]> {
    const type = this.codec.typeOf(column);
    const updated = await this.columns.updateById(column.id, {
      options: this.normalizeOptions(
        type,
        options,
        this.codec.optionsOf(column),
      ),
    });
    return columns.map((it) => (it.id === column.id ? updated : it));
  }

  /**
   * Move a column to a 0-based position and rewrite every column's position,
   * in one batch: there are at most fifty.
   */
  protected async moveColumn(
    columns: FolioColumn[],
    column: FolioColumn,
    position: number,
  ): Promise<FolioColumn[]> {
    const rest = columns.filter((it) => it.id !== column.id);
    const at = Math.max(0, Math.min(position, rest.length));
    const ordered = [...rest.slice(0, at), column, ...rest.slice(at)];
    const moved = ordered.filter((it, index) => it.position !== index);
    await this.database.atomicBatch(
      moved.map((it) =>
        this.columns.updateStatement(
          { id: { eq: it.id } },
          { position: ordered.indexOf(it) },
          { returning: false },
        ),
      ),
    );
    return ordered.map((it, index) => ({ ...it, position: index }));
  }

  /**
   * A column name, trimmed, 1 to 80 characters, unique among `others`
   * without regard to case.
   */
  protected checkName(others: FolioColumn[], raw: string): string {
    const name = raw.trim();
    if (name.length < 1 || name.length > 80) {
      throw new BadRequestError(
        `A column name is 1 to 80 characters (got ${name.length}).`,
      );
    }
    const lower = name.toLowerCase();
    if (others.some((it) => it.lowerName === lower)) {
      throw new BadRequestError(
        `This table already has a column named "${name}".`,
      );
    }
    return name;
  }

  /**
   * The options a column of `type` keeps: a select's choices (labels
   * trimmed, unique without regard to case, at most fifty, each with an id),
   * a date's `withTime`. Anything else is dropped, so a retyped column does
   * not carry the old type's settings.
   *
   * `previous` is the column's options before the write: choices passed
   * without an id keep the id of the previous choice with the same label,
   * and `withTime` is kept when not restated.
   */
  protected normalizeOptions(
    type: FolioColumnType,
    input: FolioColumnInputOptions | undefined,
    previous: {
      choices?: Array<{ id: string; label: string }>;
      withTime?: boolean;
    } = {},
  ): Record<string, unknown> {
    if (type === "date") {
      const withTime = input?.withTime ?? previous.withTime ?? false;
      return withTime ? { withTime: true } : {};
    }
    if (type !== "select") return {};
    const source = input?.choices ?? previous.choices ?? [];
    if (source.length > FolioTableService.MAX_CHOICES) {
      throw new BadRequestError(
        `A select holds at most ${FolioTableService.MAX_CHOICES} options (got ${source.length}).`,
      );
    }
    const seen = new Set<string>();
    const choices = source.map((entry) => {
      const label = (typeof entry === "string" ? entry : entry.label).trim();
      if (
        label.length < 1 ||
        label.length > FolioTableService.MAX_CHOICE_LABEL
      ) {
        throw new BadRequestError(
          `An option label is 1 to ${FolioTableService.MAX_CHOICE_LABEL} characters (got ${label.length}).`,
        );
      }
      const lower = label.toLowerCase();
      if (seen.has(lower)) {
        throw new BadRequestError(`The option "${label}" is listed twice.`);
      }
      seen.add(lower);
      const given = typeof entry === "string" ? undefined : entry.id;
      const kept = (previous.choices ?? []).find(
        (choice) => choice.label.toLowerCase() === lower,
      )?.id;
      return { id: given ?? kept ?? this.crypto.randomUUID(), label };
    });
    return { choices };
  }

  /**
   * A column by id, or by name without regard to case; a 400 listing the
   * table's columns when none answers.
   */
  public resolveColumn(columns: FolioColumn[], ref: string): FolioColumn {
    const byId = columns.find((column) => column.id === ref);
    if (byId) return byId;
    const lower = ref.trim().toLowerCase();
    const byName = columns.find((column) => column.lowerName === lower);
    if (byName) return byName;
    throw new BadRequestError(
      columns.length === 0
        ? `No column "${ref}": this table has no columns yet.`
        : `No column "${ref}". This table's columns are: ${columns.map((column) => `"${column.name}"`).join(", ")}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  /**
   * Add 1 to 100 rows, and answer them as stored. Every cell is coerced to
   * its column's type first, and the whole batch is refused, before anything
   * is written, when one cell cannot be.
   */
  protected async writeAddRows(
    folio: FolioTableTarget,
    inputs: FolioRowInput[],
    userId?: string,
  ): Promise<FolioRowResource[]> {
    this.assertTable(folio);
    this.checkBatch(inputs.length, "add");
    const [columns, existing] = await Promise.all([
      this.columnsOf(folio.id),
      this.rows.findMany({
        where: { folioId: { eq: folio.id } },
        columns: ["id", "number", "position"],
        orderBy: [{ column: "position", direction: "asc" }],
      }),
    ]);
    if (existing.length + inputs.length > FolioTableService.MAX_ROWS) {
      throw new BadRequestError(
        `A table holds at most ${FolioTableService.MAX_ROWS} rows: this one has ${existing.length}, and ${inputs.length} more would make ${existing.length + inputs.length}.`,
      );
    }

    const prepared = await this.prepareCells(
      folio,
      columns,
      inputs.map((input, index) => ({
        label: `Row ${index + 1} of the batch`,
        cells: input.cells,
      })),
    );
    const sizes = prepared.map((cells) => this.bytesOf(cells));
    await this.assertBudget(
      folio.id,
      sizes.reduce((sum, size) => sum + size, 0),
    );

    // Positions: at the bottom, or between the row named and the next one.
    // Several rows placed after the same row keep the order they came in.
    const ordered = existing as Array<{ number: number; position: number }>;
    const last = ordered.length ? ordered[ordered.length - 1].position : 0;
    const slots = new Map<number, number>();
    let bottom = last;
    const positions = inputs.map((input) => {
      if (input.after === undefined) {
        bottom += 1;
        return bottom;
      }
      const index = ordered.findIndex((row) => row.number === input.after);
      if (index < 0) {
        throw new NotFoundError(`No row ${input.after} in this table.`);
      }
      const from = slots.get(input.after) ?? ordered[index].position;
      const to = ordered[index + 1]?.position ?? ordered[index].position + 1;
      const position = (from + to) / 2;
      slots.set(input.after, position);
      return position;
    });

    const numbers: number[] = [];
    for (let i = 0; i < inputs.length; i += 1) {
      numbers.push(await this.folioRowNumber.next(folio.id));
    }
    const created = await this.rows.createMany(
      prepared.map((cells, index) => ({
        folioId: folio.id,
        number: numbers[index],
        position: positions[index],
        cells,
        searchText: this.searchTextOf(columns, cells),
        bytes: sizes[index],
        updatedByUserId: userId,
      })),
    );
    created.sort((a, b) => a.number - b.number);
    return created.map((row) => this.rowResource(columns, row));
  }

  /**
   * Write some cells of one row. With `version`, a row changed since it was
   * read answers 409; without one the write is last-write-wins on the cells
   * named. `replaced` names the cells that held a value this overwrote.
   */
  protected async writeUpdateRow(
    folio: FolioTableTarget,
    number: number,
    cells: Record<string, unknown>,
    opts: { version?: number; userId?: string } = {},
  ): Promise<{ row: FolioRowResource; replaced: string[] }> {
    this.assertTable(folio);
    const columns = await this.columnsOf(folio.id);
    const [prepared] = await this.prepareCells(
      folio,
      columns,
      [{ label: `Row ${number}`, cells }],
      true,
    );
    // Without a version the caller accepts the latest row, so a concurrent
    // write of another cell is retried once rather than refused.
    for (let attempt = 0; ; attempt += 1) {
      const row = await this.findRow(folio.id, number);
      if (opts.version !== undefined && opts.version !== row.version) {
        throw new ConflictError(
          `Row ${number} changed since it was read (version ${row.version}, not ${opts.version}): re-read it before writing.`,
        );
      }
      const next = this.liveCells(columns, row.cells);
      const replaced: string[] = [];
      for (const [columnId, value] of Object.entries(prepared)) {
        const column = columns.find((it) => it.id === columnId)!;
        if (this.codec.read(column, row.cells[columnId]) !== null) {
          replaced.push(column.name);
        }
        if (value === null) delete next[columnId];
        else next[columnId] = value;
      }
      const bytes = this.bytesOf(next);
      // Only a write that grows the row can be refused: one that shortens
      // a cell or empties it always lands.
      if (bytes > row.bytes)
        await this.assertBudget(folio.id, bytes - row.bytes);
      const updated: FolioRowRecord = {
        ...row,
        cells: next,
        searchText: this.searchTextOf(columns, next),
        bytes,
        updatedByUserId: opts.userId ?? row.updatedByUserId,
      };
      try {
        await this.rows.save(updated);
        return { row: this.rowResource(columns, updated), replaced };
      } catch (error) {
        if (
          opts.version === undefined &&
          attempt === 0 &&
          (error as { status?: number }).status === 409
        ) {
          continue;
        }
        if ((error as { status?: number }).status === 409) {
          throw new ConflictError(
            `Row ${number} changed while it was being written: re-read it before writing.`,
          );
        }
        throw error;
      }
    }
  }

  /**
   * Move a row before or after another, by number. Only the moved row is
   * written: it takes the midpoint of its new neighbours.
   */
  protected async writeMoveRow(
    folio: FolioTableTarget,
    number: number,
    to: { before?: number; after?: number },
    userId?: string,
  ): Promise<FolioRowResource> {
    this.assertTable(folio);
    if ((to.before === undefined) === (to.after === undefined)) {
      throw new BadRequestError("Move a row either before or after another.");
    }
    const [columns, ordered] = await Promise.all([
      this.columnsOf(folio.id),
      this.rows.findMany({
        where: { folioId: { eq: folio.id } },
        columns: ["id", "number", "position"],
        orderBy: [{ column: "position", direction: "asc" }],
      }),
    ]);
    const others = (
      ordered as Array<{ number: number; position: number }>
    ).filter((row) => row.number !== number);
    const anchorNumber = (to.before ?? to.after)!;
    const index = others.findIndex((row) => row.number === anchorNumber);
    if (index < 0) {
      throw new NotFoundError(`No row ${anchorNumber} in this table.`);
    }
    const anchor = others[index];
    const position =
      to.before !== undefined
        ? (anchor.position +
            (others[index - 1]?.position ?? anchor.position - 1)) /
          2
        : (anchor.position +
            (others[index + 1]?.position ?? anchor.position + 1)) /
          2;
    const row = await this.findRow(folio.id, number);
    const updated = await this.rows.updateById(row.id, {
      position,
      updatedByUserId: userId ?? row.updatedByUserId,
    });
    return this.rowResource(columns, updated);
  }

  /**
   * Delete 1 to 100 rows by number, and answer the numbers deleted. A number
   * no row holds is skipped, so a retried delete is not an error.
   */
  protected async writeDeleteRows(
    folio: FolioTableTarget,
    numbers: number[],
  ): Promise<number[]> {
    this.assertTable(folio);
    this.checkBatch(numbers.length, "delete");
    const found = await this.rows.findMany({
      where: {
        folioId: { eq: folio.id },
        number: { inArray: [...new Set(numbers)] },
      },
      columns: ["id", "number"],
    });
    if (found.length === 0) return [];
    await this.rows.deleteMany({
      id: { inArray: found.map((row) => row.id) },
    });
    return found.map((row) => row.number).sort((a, b) => a - b);
  }

  /**
   * Copy a table's columns and rows to another folio, which must have none:
   * fresh ids, the same row numbers, and the target's row sequence moved
   * past them so its next row does not reuse one.
   */
  public async copyTable(
    fromFolioId: string,
    toFolioId: string,
    projectId?: number,
  ): Promise<void> {
    const { columns, rows } = await this.snapshot(fromFolioId);
    const ids = new Map<string, string>();
    if (columns.length) {
      const created = await this.columns.createMany(
        columns.map((column) => ({
          folioId: toFolioId,
          position: column.position,
          name: column.name,
          lowerName: column.lowerName,
          type: column.type,
          options: column.options,
        })),
      );
      columns.forEach((column, index) => ids.set(column.id, created[index].id));
    }
    if (rows.length) {
      await this.rows.createMany(
        rows.map((row) => {
          const cells: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row.cells)) {
            const id = ids.get(key);
            if (id) cells[id] = value;
          }
          return {
            folioId: toFolioId,
            number: row.number,
            position: row.position,
            cells,
            searchText: row.searchText,
            bytes: this.bytesOf(cells),
            updatedByUserId: row.updatedByUserId,
          };
        }),
      );
    }
    const highest = Math.max(
      0,
      ...rows.map((row) => row.number),
      (await this.folioRowNumber.current(fromFolioId)) ?? 0,
    );
    if (highest > 0) await this.folioRowNumber.reset(highest, toFolioId);
    if (projectId !== undefined) {
      await this.syncReferenceLinks({
        id: toFolioId,
        projectId,
        type: "table",
      });
    }
  }

  /**
   * The columns a folio of this type starts with when none is asked for: a
   * table one text column "Name", a calendar an entry's "Title" and the
   * "Date" it lays it out by (#Q3717).
   */
  public defaultColumns(
    type: string,
  ): Array<{ name: string; type: FolioColumnType }> {
    return type === "calendar"
      ? [
          { name: "Title", type: "text" },
          { name: "Date", type: "date" },
        ]
      : [{ name: "Name", type: "text" }];
  }

  /**
   * The columns a new table or calendar starts with: the ones asked for,
   * or its type's defaults when none is.
   */
  public async seedColumns(
    folio: FolioTableTarget,
    inputs: Array<{
      name: string;
      type: FolioColumnType;
      options?: FolioColumnInputOptions;
    }>,
  ): Promise<FolioColumnResource[]> {
    const wanted = inputs.length ? inputs : this.defaultColumns(folio.type);
    return this.applyColumnOperations(
      folio,
      wanted.map((input) => ({ op: "add" as const, ...input })),
    );
  }

  // -------------------------------------------------------------------------
  // Writes, each recorded in the folio's history (#Q3513)
  // -------------------------------------------------------------------------

  /**
   * Apply a list of column operations in order, and answer the columns as
   * they stand after the last. See {@link writeApplyColumnOperations}.
   */
  public async applyColumnOperations(
    folio: FolioTableTarget,
    operations: FolioColumnOperation[],
    userId?: string,
  ): Promise<FolioColumnResource[]> {
    return this.recorded(
      folio,
      userId,
      () => this.writeApplyColumnOperations(folio, operations),
      "always",
    );
  }

  /**
   * Add 1 to 100 rows. See {@link writeAddRows}.
   */
  public async addRows(
    folio: FolioTableTarget,
    inputs: FolioRowInput[],
    userId?: string,
  ): Promise<FolioRowResource[]> {
    return this.recorded(folio, userId, () =>
      this.writeAddRows(folio, inputs, userId),
    );
  }

  /**
   * Write some cells of one row. See {@link writeUpdateRow}.
   */
  public async updateRow(
    folio: FolioTableTarget,
    number: number,
    cells: Record<string, unknown>,
    opts: { version?: number; userId?: string } = {},
  ): Promise<{ row: FolioRowResource; replaced: string[] }> {
    return this.recorded(folio, opts.userId, () =>
      this.writeUpdateRow(folio, number, cells, opts),
    );
  }

  /**
   * Move a row before or after another. See {@link writeMoveRow}.
   */
  public async moveRow(
    folio: FolioTableTarget,
    number: number,
    to: { before?: number; after?: number },
    userId?: string,
  ): Promise<FolioRowResource> {
    return this.recorded(folio, userId, () =>
      this.writeMoveRow(folio, number, to, userId),
    );
  }

  /**
   * Delete 1 to 100 rows by number. See {@link writeDeleteRows}.
   */
  public async deleteRows(
    folio: FolioTableTarget,
    numbers: number[],
    userId?: string,
  ): Promise<number[]> {
    return this.recorded(folio, userId, () =>
      this.writeDeleteRows(folio, numbers),
    );
  }

  /**
   * Run a table write inside the folio's history, as a content write runs
   * inside it (#Q3513): one revision per writing session, folded into while
   * the session lasts.
   *
   * Before the write, a revision that is about to stop being the head is
   * filled in with the table as it stood: that is the one read of the rows
   * a session costs, and none inside it. After the write, the session's
   * revision is folded into or a new one opened. A table write is an
   * `edit`.
   *
   * A write without an author, or without the folio's title, records
   * nothing: only service-level callers do that.
   */
  protected async recorded<T>(
    folio: FolioTableTarget,
    userId: string | undefined,
    write: () => Promise<T>,
    links: "always" | "ifReference" = "ifReference",
  ): Promise<T> {
    this.assertTable(folio);
    if (!userId || folio.title === undefined) {
      const result = await write();
      await this.syncReferenceLinks(folio, links);
      return result;
    }
    const plan = await this.history.prepareRevisionLazy(
      folio.id,
      userId,
      "edit",
      () => this.encodeSnapshot(folio.id),
    );
    const result = await write();
    await Promise.all([
      this.history.recordRevision(
        { id: folio.id, title: folio.title, summary: folio.summary ?? "" },
        userId,
        plan,
      ),
      this.syncReferenceLinks(folio, links),
    ]);
    return result;
  }

  /**
   * Re-sync the folio's outbound links from its reference cells (#Q3514),
   * by the same sync a text folio's save runs: a reference cell is a link,
   * and the quest or folio it names lists the table among its backlinks.
   *
   * `ifReference` skips a table with no reference column, which is what a
   * row write on most tables is; a column operation passes `always`, since
   * removing or retyping the last reference column must clear its links.
   */
  public async syncReferenceLinks(
    folio: FolioTableTarget,
    mode: "always" | "ifReference" = "always",
  ): Promise<void> {
    const columns = (await this.columnsOf(folio.id)).filter(
      (column) => this.codec.typeOf(column) === "reference",
    );
    if (columns.length === 0 && mode === "ifReference") return;
    const codes = new Set<string>();
    if (columns.length) {
      const rows = await this.rows.findMany({
        where: { folioId: { eq: folio.id } },
        columns: ["cells"],
      });
      for (const row of rows) {
        for (const column of columns) {
          const value = this.codec.read(column, row.cells?.[column.id]);
          if (typeof value === "string") codes.add(value);
        }
      }
    }
    await this.links.syncLinks(
      { kind: "folio", id: folio.id, projectId: folio.projectId },
      [...codes].map((code) => `[[${code}]]`).join(" "),
    );
  }

  /**
   * The table rows of a project whose text holds `needle`, one per folio
   * (the first in position order), with the row as text (#Q3514).
   *
   * Scoped to the project in SQL: the project's unprotected table folios
   * first, by the `(projectId, ...)` indexes of `folios`, then their rows by
   * `(folioId, position)`. It never reads a row of another project.
   */
  public async searchRows(
    projectId: number,
    needle: string,
    limit = 50,
  ): Promise<Array<{ folioId: string; number: number; text: string }>> {
    // Each word of the needle, escaped and cut to D1's pattern limit (#Q4271).
    const text = this.searchTerms.conditions("searchText", needle);
    if (text.length === 0) return [];
    const tableIds = (
      await this.folios.findMany({
        where: {
          projectId: { eq: projectId },
          type: { inArray: ["table", "calendar"] },
          protected: { eq: false },
        },
        columns: ["id"],
      })
    ).map((row) => row.id);
    if (tableIds.length === 0) return [];
    const matched = await this.bound.collect(tableIds, (batch) =>
      this.rows.findMany({
        where: {
          folioId: { inArray: batch },
          and: text,
        },
        orderBy: [{ column: "position", direction: "asc" }],
      }),
    );
    const first = new Map<string, FolioRowRecord>();
    for (const row of matched) {
      if (!first.has(row.folioId)) first.set(row.folioId, row);
    }
    const hits = [...first.values()].slice(0, limit);
    if (hits.length === 0) return [];
    const columns = await this.bound.collect(
      hits.map((row) => row.folioId),
      (batch) =>
        this.columns.findMany({
          where: { folioId: { inArray: batch } },
          orderBy: [{ column: "position", direction: "asc" }],
        }),
    );
    return hits.map((row) => {
      const own = columns.filter((column) => column.folioId === row.folioId);
      return {
        folioId: row.folioId,
        number: row.number,
        text: this.rowText(own, row.cells),
      };
    });
  }

  /**
   * A row's cells as one line of text, `Column: value` joined by ` · `,
   * empty cells left out: what a search snippet shows.
   */
  public rowText(
    columns: FolioColumn[],
    stored: Record<string, unknown>,
  ): string {
    return columns
      .flatMap((column) => {
        const value = this.codec.read(column, stored?.[column.id]);
        if (value === null) return [];
        const text =
          this.codec.typeOf(column) === "checkbox"
            ? value
              ? "yes"
              : "no"
            : this.codec.displayText(column, value);
        return text ? [`${column.name}: ${text}`] : [];
      })
      .join(" · ");
  }

  // -------------------------------------------------------------------------
  // Snapshots (#Q3513)
  // -------------------------------------------------------------------------

  /**
   * The table as it stands, serialised for a revision's `contentSnapshot`.
   */
  public async encodeSnapshot(folioId: string): Promise<string> {
    const { columns, rows } = await this.snapshot(folioId);
    const data: FolioTableSnapshotData = {
      v: 1,
      columns: columns.map((column) => ({
        id: column.id,
        position: column.position,
        name: column.name,
        type: column.type,
        options: column.options ?? {},
      })),
      rows: rows.map((row) => ({
        id: row.id,
        number: row.number,
        position: row.position,
        cells: this.liveCells(columns, row.cells),
      })),
    };
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json).length;
    return bytes > FolioTableService.MAX_SNAPSHOT_BYTES
      ? JSON.stringify({ v: 1, tooLarge: true, bytes })
      : json;
  }

  /**
   * A revision's snapshot, or `undefined` when it does not decode: an empty
   * one (a table's first revision before any write), a version this build
   * does not know, or a corrupt one. Never throws: a snapshot that cannot
   * be read must not take the history with it.
   */
  public decodeSnapshot(raw: string): FolioTableSnapshotData | undefined {
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const data = parsed as Partial<FolioTableSnapshotData> | null;
    if (
      !data ||
      typeof data !== "object" ||
      data.v !== 1 ||
      !Array.isArray(data.columns) ||
      !Array.isArray(data.rows)
    ) {
      return undefined;
    }
    const columns = data.columns.filter(
      (column) =>
        column &&
        typeof column.id === "string" &&
        typeof column.name === "string" &&
        typeof column.type === "string" &&
        Number.isFinite(column.position),
    );
    const rows = data.rows.filter(
      (row) =>
        row &&
        typeof row.id === "string" &&
        Number.isSafeInteger(row.number) &&
        row.number > 0 &&
        Number.isFinite(row.position),
    );
    return {
      v: 1,
      columns: columns.map((column) => ({
        ...column,
        options:
          column.options && typeof column.options === "object"
            ? column.options
            : {},
      })),
      rows: rows.map((row) => ({
        ...row,
        cells: row.cells && typeof row.cells === "object" ? row.cells : {},
      })),
    };
  }

  /**
   * Replace the table's columns and rows with a snapshot's, in one batch
   * (#Q3513). Row numbers come back as they were; the folio's row sequence
   * never moves backwards, so no number is reused after a revert. The
   * caller records the revision.
   */
  public async restoreSnapshot(
    folio: FolioTableTarget,
    data: FolioTableSnapshotData,
    userId?: string,
  ): Promise<void> {
    this.assertTable(folio);
    const names = new Set<string>();
    const columns = data.columns
      .slice(0, FolioTableService.MAX_COLUMNS)
      .filter((column) => {
        const lower = column.name.toLowerCase();
        if (names.has(lower)) return false;
        names.add(lower);
        return true;
      });
    const numbers = new Set<number>();
    const rows = data.rows
      .slice(0, FolioTableService.MAX_ROWS)
      .filter((row) => {
        if (numbers.has(row.number)) return false;
        numbers.add(row.number);
        return true;
      });
    const stored = columns.map((column) => ({
      ...column,
      folioId: folio.id,
      lowerName: column.name.toLowerCase(),
    })) as unknown as FolioColumn[];
    // A revert replaces every row, so it is measured whole: refused only
    // when it would leave the table past the budget AND larger than now.
    const sizes = rows.map((row) => this.bytesOf(row.cells));
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const weighs = await this.tableBytes(folio.id);
    if (total > weighs)
      await this.assertBudget(folio.id, total - weighs, weighs);
    await this.database.atomicBatch([
      this.rows.deleteStatement({ folioId: { eq: folio.id } }),
      this.columns.deleteStatement({ folioId: { eq: folio.id } }),
      ...columns.map((column) =>
        this.columns.insertStatement({
          id: column.id,
          folioId: folio.id,
          position: column.position,
          name: column.name,
          lowerName: column.name.toLowerCase(),
          type: column.type,
          options: column.options,
        }),
      ),
      ...rows.map((row) =>
        this.rows.insertStatement({
          id: row.id,
          folioId: folio.id,
          number: row.number,
          position: row.position,
          cells: row.cells,
          searchText: this.searchTextOf(stored, row.cells),
          bytes: sizes[rows.indexOf(row)],
          updatedByUserId: userId,
        }),
      ),
    ]);
    const highest = Math.max(0, ...rows.map((row) => row.number));
    const current = (await this.folioRowNumber.current(folio.id)) ?? 0;
    if (highest > current) await this.folioRowNumber.reset(highest, folio.id);
    await this.syncReferenceLinks(folio);
  }

  // -------------------------------------------------------------------------
  // The view (#Q3518)
  // -------------------------------------------------------------------------

  /**
   * How the folio is read, resolved against its columns and read leniently:
   * a date column that no longer exists falls back to the first date column,
   * and a calendar with none reads as a grid. The title column falls back
   * to the first text column, then to the first column.
   *
   * The kind is the folio's type (#Q3717): a table is a grid, a calendar a
   * month. The stored row only picks the columns.
   */
  public async viewOf(
    folio: { id: string; type: string },
    columns?: FolioColumn[],
  ): Promise<FolioTableView> {
    const [stored, all] = await Promise.all([
      this.views.findOne({ where: { folioId: { eq: folio.id } } }),
      columns ? Promise.resolve(columns) : this.columnsOf(folio.id),
    ]);
    return this.resolveView(folio.type, all, stored ?? undefined);
  }

  /**
   * The view a stored row (or none) resolves to against these columns.
   */
  public resolveView(
    folioType: string,
    columns: FolioColumn[],
    stored?: { dateColumnId?: string; titleColumnId?: string },
  ): FolioTableView {
    const dates = columns.filter((c) => this.codec.typeOf(c) === "date");
    const date = dates.find((c) => c.id === stored?.dateColumnId) ?? dates[0];
    const title =
      columns.find((c) => c.id === stored?.titleColumnId) ??
      columns.find((c) => this.codec.typeOf(c) === "text") ??
      columns[0];
    return {
      kind: date && folioType === "calendar" ? "calendar" : "grid",
      ...(date ? { dateColumnId: date.id } : {}),
      ...(title ? { titleColumnId: title.id } : {}),
    };
  }

  /**
   * Several tables at once, for the dashboard's Folio cards (#Q3520): one
   * read of their columns, one of their rows and one of their views,
   * whatever the number of cards.
   */
  public async tablesOf(
    folios: Array<{ id: string; type: string }>,
  ): Promise<
    Map<
      string,
      { columns: FolioColumn[]; rows: FolioRowResource[]; view: FolioTableView }
    >
  > {
    const ids = [...new Set(folios.map((folio) => folio.id))];
    const out = new Map<
      string,
      { columns: FolioColumn[]; rows: FolioRowResource[]; view: FolioTableView }
    >();
    if (ids.length === 0) return out;
    const [columns, rows, views] = await Promise.all([
      this.bound.collect(ids, (batch) =>
        this.columns.findMany({
          where: { folioId: { inArray: batch } },
          orderBy: [{ column: "position", direction: "asc" }],
        }),
      ),
      this.bound.collect(ids, (batch) =>
        this.rows.findMany({
          where: { folioId: { inArray: batch } },
          orderBy: [{ column: "position", direction: "asc" }],
        }),
      ),
      this.bound.collect(ids, (batch) =>
        this.views.findMany({ where: { folioId: { inArray: batch } } }),
      ),
    ]);
    for (const id of ids) {
      const own = columns.filter((column) => column.folioId === id);
      out.set(id, {
        columns: own,
        rows: rows
          .filter((row) => row.folioId === id)
          .map((row) => this.rowResource(own, row)),
        view: this.resolveView(
          folios.find((folio) => folio.id === id)?.type ?? "table",
          own,
          views.find((view) => view.folioId === id),
        ),
      });
    }
    return out;
  }

  /**
   * Remember the columns a calendar reads: the date it lays rows out by and
   * the column that titles an entry. Column ids are checked against the
   * table, so a stored view never names a column of another folio. Whether
   * the folio is a grid or a calendar is its type, never this (#Q3717).
   */
  public async setView(
    folio: FolioTableTarget,
    input: {
      dateColumnId?: string;
      titleColumnId?: string;
    },
  ): Promise<FolioTableView> {
    this.assertTable(folio);
    const columns = await this.columnsOf(folio.id);
    for (const ref of [input.dateColumnId, input.titleColumnId]) {
      if (ref !== undefined) this.resolveColumn(columns, ref);
    }
    if (
      input.dateColumnId !== undefined &&
      this.codec.typeOf(this.resolveColumn(columns, input.dateColumnId)) !==
        "date"
    ) {
      throw new BadRequestError("A calendar reads a date column.");
    }
    const data = {
      // Kept for the column's NOT NULL, and read by nothing: the kind is the
      // folio's type (#Q3717).
      kind: folio.type === "calendar" ? "calendar" : "grid",
      dateColumnId: input.dateColumnId
        ? this.resolveColumn(columns, input.dateColumnId).id
        : undefined,
      titleColumnId: input.titleColumnId
        ? this.resolveColumn(columns, input.titleColumnId).id
        : undefined,
    };
    const existing = await this.views.findOne({
      where: { folioId: { eq: folio.id } },
    });
    if (existing) {
      await this.views.updateById(existing.id, data);
    } else {
      await this.views.create({ folioId: folio.id, ...data });
    }
    return this.resolveView(folio.type, columns, data);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  protected checkBatch(count: number, verb: string): void {
    if (count < 1 || count > FolioTableService.MAX_BATCH) {
      throw new BadRequestError(
        `Rows ${verb} 1 to ${FolioTableService.MAX_BATCH} at a time (got ${count}).`,
      );
    }
  }

  protected async findRow(
    folioId: string,
    number: number,
  ): Promise<FolioRowRecord> {
    const row = await this.rows.findOne({
      where: { folioId: { eq: folioId }, number: { eq: number } },
    });
    if (!row) throw new NotFoundError(`No row ${number} in this table.`);
    return row;
  }

  protected async allRows(folioId: string): Promise<FolioRowRecord[]> {
    return this.rows.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [{ column: "position", direction: "asc" }],
    });
  }

  /**
   * Every column of the table keyed, each cell read leniently.
   */
  protected readCells(
    columns: FolioColumn[],
    stored: Record<string, unknown>,
  ): Record<string, FolioCellValue> {
    const cells: Record<string, FolioCellValue> = {};
    for (const column of columns) {
      cells[column.id] = this.codec.read(column, stored?.[column.id]);
    }
    return cells;
  }

  /**
   * The stored cells whose column still exists: what a write starts from, so
   * a removed column's key is dropped by the row's next write.
   */
  /**
   * The UTF-8 length of cells as JSON: what a row weighs in a snapshot
   * (#Q3708).
   */
  public bytesOf(cells: Record<string, unknown>): number {
    return new TextEncoder().encode(JSON.stringify(cells)).length;
  }

  /**
   * What a table's cells weigh, from `folio_rows.bytes`: one `SUM`, no row
   * read (#Q3708).
   */
  public async tableBytes(folioId: string): Promise<number> {
    const [total] = await this.rows.aggregate({
      select: { bytes: { sum: true } },
      where: { folioId: { eq: folioId } },
    });
    return Number(total?.bytes.sum ?? 0);
  }

  /**
   * Refuse a write that adds `added` bytes when the table would end past
   * `MAX_TABLE_BYTES`, saying how big the table is, what the write adds and
   * the budget. `current` skips the read when the caller has it.
   */
  protected async assertBudget(
    folioId: string,
    added: number,
    current?: number,
  ): Promise<void> {
    if (added <= 0) return;
    const before = current ?? (await this.tableBytes(folioId));
    if (before + added <= FolioTableService.MAX_TABLE_BYTES) return;
    const kb = (bytes: number) =>
      `${Math.ceil(bytes / 1000).toLocaleString("en-US")} KB`;
    throw new BadRequestError(
      `A table holds at most ${kb(FolioTableService.MAX_TABLE_BYTES)} of cells, so every revision can keep a copy of it: this one holds ${kb(before)}, and this write adds ${kb(added)}. Delete rows or shorten cells first.`,
    );
  }

  protected liveCells(
    columns: FolioColumn[],
    stored: Record<string, unknown>,
  ): Record<string, unknown> {
    const cells: Record<string, unknown> = {};
    for (const column of columns) {
      const value = stored?.[column.id];
      if (value !== undefined && value !== null) cells[column.id] = value;
    }
    return cells;
  }

  /**
   * Coerce each input's cells to their columns, keyed by column id. `partial`
   * keeps a `null` (the cell is cleared) where a new row simply omits it.
   * References are checked against their project in one read per kind.
   */
  protected async prepareCells(
    folio: FolioTableTarget,
    columns: FolioColumn[],
    inputs: Array<{ label: string; cells: Record<string, unknown> }>,
    partial = false,
  ): Promise<Array<Record<string, FolioCellValue>>> {
    const references: Array<{
      label: string;
      column: FolioColumn;
      code: string;
    }> = [];
    const prepared = inputs.map((input) => {
      const cells: Record<string, FolioCellValue> = {};
      for (const [key, raw] of Object.entries(input.cells ?? {})) {
        const column = this.resolveColumn(columns, key);
        const coerced = this.codec.coerce(column, raw);
        if (!coerced.ok) {
          throw new BadRequestError(
            `${input.label}, column "${column.name}": expected ${coerced.expected}, got ${this.describeValue(raw)}.`,
          );
        }
        if (coerced.value === null && !partial) continue;
        cells[column.id] = coerced.value;
        if (
          coerced.value !== null &&
          this.codec.typeOf(column) === "reference"
        ) {
          references.push({
            label: input.label,
            column,
            code: String(coerced.value),
          });
        }
      }
      return cells;
    });
    await this.checkReferences(folio.projectId, references);
    return prepared;
  }

  /**
   * Refuse a reference whose letter no module claims, or whose number names
   * nothing in the project.
   */
  protected async checkReferences(
    projectId: number,
    references: Array<{ label: string; column: FolioColumn; code: string }>,
  ): Promise<void> {
    if (references.length === 0) return;
    const byKind = new Map<string, typeof references>();
    for (const ref of references) {
      const parsed = this.resources.parseReference(ref.code);
      if (!parsed) {
        throw new BadRequestError(
          `${ref.label}, column "${ref.column.name}": ${ref.code} names no kind of item this Lore knows.`,
        );
      }
      byKind.set(parsed.kind, [...(byKind.get(parsed.kind) ?? []), ref]);
    }
    for (const [kind, refs] of byKind) {
      const resolve = this.resources.get(kind)?.resolveNumbers;
      if (!resolve) continue;
      const numbers = refs.map((ref) => Number(ref.code.slice(2)));
      const found = await resolve(projectId, [...new Set(numbers)]);
      const missing = refs.find((ref) => !found.has(Number(ref.code.slice(2))));
      if (missing) {
        throw new BadRequestError(
          `${missing.label}, column "${missing.column.name}": ${missing.code} does not exist in this project.`,
        );
      }
    }
  }

  protected describeValue(raw: unknown): string {
    const text = JSON.stringify(raw) ?? String(raw);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }

  /**
   * The lowercased text of a row's cells, for search.
   */
  public searchTextOf(
    columns: FolioColumn[],
    stored: Record<string, unknown>,
  ): string {
    return columns
      .map((column) =>
        this.codec.displayText(
          column,
          this.codec.read(column, stored?.[column.id]),
        ),
      )
      .filter((text) => text !== "")
      .join(" ")
      .toLowerCase();
  }

  /**
   * Rebuild every row's `searchText` after a column change that alters how a
   * cell reads (a retype, an option renamed, a column removed): one pass,
   * one batch, writing only the rows whose text moved. Neither `updatedAt`
   * nor `version` moves: no cell changed.
   */
  protected async reindex(
    folioId: string,
    columns: FolioColumn[],
  ): Promise<void> {
    const rows = await this.rows.findMany({
      where: { folioId: { eq: folioId } },
      columns: ["id", "cells", "searchText", "bytes"],
    });
    const statements = rows.flatMap((row) => {
      const text = this.searchTextOf(columns, row.cells ?? {});
      // A removed column's cells leave the live cells, so the row's size
      // drops with it (#Q3708).
      const bytes = this.bytesOf(this.liveCells(columns, row.cells ?? {}));
      return text === row.searchText && bytes === row.bytes
        ? []
        : [
            this.rows.updateStatement(
              { id: { eq: row.id } },
              { searchText: text, bytes },
              { touch: false, version: false, returning: false },
            ),
          ];
    });
    await this.database.atomicBatch(statements);
  }

  /**
   * Whether one read cell passes one filter.
   */
  protected matches(
    column: FolioColumn,
    value: FolioCellValue,
    filter: FolioRowFilter,
  ): boolean {
    if (filter.isEmpty !== undefined) {
      if ((value === null) !== filter.isEmpty) return false;
    }
    if (filter.equals !== undefined) {
      const wanted = this.codec.read(column, filter.equals);
      if (value === null || wanted === null) return false;
      if (this.codec.typeOf(column) === "text") {
        if (String(value).toLowerCase() !== String(wanted).toLowerCase()) {
          return false;
        }
      } else if (value !== wanted) {
        return false;
      }
    }
    if (filter.contains !== undefined) {
      const text = this.codec.displayText(column, value).toLowerCase();
      if (!text.includes(filter.contains.toLowerCase())) return false;
    }
    if (filter.from !== undefined || filter.to !== undefined) {
      if (value === null) return false;
      if (
        filter.from !== undefined &&
        this.rangeCompare(column, value, filter.from) < 0
      ) {
        return false;
      }
      if (
        filter.to !== undefined &&
        this.rangeCompare(column, value, filter.to) > 0
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * A value against a range bound: numbers as numbers, dates by day when
   * either side is a day, by instant otherwise.
   */
  protected rangeCompare(
    column: FolioColumn,
    value: FolioCellValue,
    bound: string | number,
  ): number {
    if (this.codec.typeOf(column) === "number") {
      return Number(value) - Number(bound);
    }
    const left = String(value);
    const right = String(bound).trim();
    const byDay = left.length === 10 || right.length === 10;
    const a = byDay ? left.slice(0, 10) : left;
    const b = byDay
      ? right.slice(0, 10)
      : (() => {
          const at = new Date(right);
          return Number.isNaN(at.getTime()) ? right : at.toISOString();
        })();
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

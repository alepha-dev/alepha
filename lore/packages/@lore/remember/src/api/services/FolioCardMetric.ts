import {
  BoundParameters,
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import type { DashboardCardValue } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import type { FolioColumn } from "../entities/folioColumns.ts";
import { type Folio, folios } from "../entities/folios.ts";
import { folioCardFiltersSchema } from "../schemas/folioCardFiltersSchema.ts";
import type { FolioRowResource } from "../schemas/folioRowResourceSchema.ts";
import { FolioCellCodec } from "./FolioCellCodec.ts";
import { FolioTableService } from "./FolioTableService.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * The Folio card (#E144, #Q3520): a folio the person points the card at, as
 * a piece of the project's knowledge on the board.
 *
 * - `note`: the folio's Markdown, cut at a heading or paragraph boundary to
 *   fit, with "Read more" when it was cut.
 * - `rows`: a table's first rows in position order, up to four columns
 *   (`table` presentation).
 * - `upcoming`: the next rows by the table's date column from today on,
 *   rows dated today first (`feed` presentation: a future date reads "in
 *   3 days" there, so it needs no renderer of its own). Nothing ahead is
 *   `empty: "nothingAhead"`, never a zero.
 *
 * `auto` picks by what the folio is. A folio deleted, encrypted or never
 * picked is `empty: "noFolio"`; a table with no row `empty: "noRows"`. The
 * reader's `folio:read` is checked by the catalogue (`requires`).
 *
 * Every card on a board resolves in one batch: one read of the folios, then
 * one of the tables' columns, rows and views.
 */
export class FolioCardMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "folio";

  protected readonly folios = $repository(folios);
  protected readonly tables = $inject(FolioTableService);
  protected readonly codec = $inject(FolioCellCodec);
  protected readonly bound = $inject(BoundParameters);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * About what a 2 by 2 card shows of a note.
   */
  static readonly NOTE_CHARS = 900;

  /**
   * Refuse a card on an encrypted folio before it is stored (#Q3709): the
   * picker never offers one, and a card cannot read it, so a write that
   * names one through the API is a mistake to say, not a card to keep.
   * A folio encrypted after its card was saved still resolves `noFolio`.
   */
  async checkFilters(
    projectId: number,
    filters: Record<string, unknown>,
  ): Promise<void> {
    const parsed = folioCardFiltersSchema.safeParse(filters);
    if (!parsed.success || parsed.data.folio <= 0) return;
    const [folio] = await this.folios.findMany({
      where: {
        projectId: { eq: projectId },
        shortId: { eq: parsed.data.folio },
      },
      columns: ["id", "protected"],
      limit: 1,
    });
    if (folio?.protected) {
      throw new BadRequestError(
        `Folio ${parsed.data.folio} is encrypted: a dashboard card cannot read an encrypted folio.`,
      );
    }
  }

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<Map<number, CardValue>> {
    const out = new Map<number, CardValue>();
    const wanted = cards.map((entry) => {
      const parsed = folioCardFiltersSchema.safeParse(entry.filters ?? {});
      return {
        entry,
        filters: parsed.success ? parsed.data : undefined,
        project: entry.scope.projects[0],
      };
    });

    const pairs = wanted.filter(
      (it) => it.project && it.filters && it.filters.folio > 0,
    );
    const projectIds = [...new Set(pairs.map((it) => it.project!.id))];
    const shortIds = [...new Set(pairs.map((it) => it.filters!.folio))];
    const found = projectIds.length
      ? await this.bound.collect(shortIds, (batch) =>
          this.folios.findMany({
            where: {
              projectId: { inArray: projectIds },
              shortId: { inArray: batch },
            },
          }),
        )
      : [];
    const folioOf = (projectId: number, shortId: number) =>
      found.find((f) => f.projectId === projectId && f.shortId === shortId);
    const tableIds = pairs.flatMap((it) => {
      const f = folioOf(it.project!.id, it.filters!.folio);
      return f && f.type !== "text" && !f.protected ? [f] : [];
    });
    const tables = await this.tables.tablesOf(tableIds);

    for (const { entry, filters, project } of wanted) {
      const folio =
        project && filters && filters.folio > 0
          ? folioOf(project.id, filters.folio)
          : undefined;
      if (!project || !filters || !folio || folio.protected) {
        out.set(entry.card.id, { empty: "noFolio", detail: {} });
        continue;
      }
      const link = {
        route: "projectFoliosFolio",
        params: {
          projectSlug: project.slug ?? "",
          shortId: String(folio.shortId),
        },
      };
      const limit = filters.limit ?? 5;
      const table = folio.type !== "text" ? tables.get(folio.id) : undefined;
      const show =
        filters.show !== "auto"
          ? filters.show
          : !table
            ? "note"
            : table.view.kind === "calendar"
              ? "upcoming"
              : "rows";

      if (show === "note" || !table) {
        const { markdown, cut } = this.cutNote(folio);
        out.set(entry.card.id, {
          presentation: "note",
          detail: { title: folio.title, markdown, more: cut },
          link,
        });
        continue;
      }
      if (table.rows.length === 0) {
        out.set(entry.card.id, { empty: "noRows", detail: {}, link });
        continue;
      }
      if (show === "upcoming" && table.view.dateColumnId) {
        out.set(
          entry.card.id,
          this.upcoming(table, table.view.dateColumnId, limit, link),
        );
        continue;
      }
      out.set(entry.card.id, this.firstRows(table, limit, link));
    }
    return out;
  }

  /**
   * A table's first rows, up to four columns, as the `table` presentation
   * draws them.
   */
  protected firstRows(
    table: { columns: FolioColumn[]; rows: FolioRowResource[] },
    limit: number,
    link: { route: string; params: Record<string, string> },
  ): CardValue {
    const columns = table.columns.slice(0, 4);
    const rows = table.rows.slice(0, limit);
    return {
      presentation: "table",
      rows: rows.map((row) => ({
        id: String(row.number),
        title: this.text(columns[0], row),
        link,
      })),
      detail: {
        columns: columns.map((column) => column.name),
        cells: rows.map((row) =>
          columns.map((column) => this.text(column, row)),
        ),
      },
      link,
    };
  }

  /**
   * The next rows by date from today on, today's first, each with its date.
   */
  protected upcoming(
    table: {
      columns: FolioColumn[];
      rows: FolioRowResource[];
      view: { titleColumnId?: string };
    },
    dateColumnId: string,
    limit: number,
    link: { route: string; params: Record<string, string> },
  ): CardValue {
    const today = this.dateTime.now().format("YYYY-MM-DD");
    const titleColumn = table.columns.find(
      (column) => column.id === table.view.titleColumnId,
    );
    const ahead = table.rows
      .map((row) => ({ row, at: row.cells[dateColumnId] }))
      .filter(
        (it): it is { row: FolioRowResource; at: string } =>
          typeof it.at === "string" && it.at.slice(0, 10) >= today,
      )
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      .slice(0, limit);
    if (ahead.length === 0) {
      return { empty: "nothingAhead", detail: {}, link };
    }
    return {
      presentation: "feed",
      rows: ahead.map(({ row, at }) => ({
        id: String(row.number),
        title: titleColumn ? this.text(titleColumn, row) : `#${row.number}`,
        // A day-only date reads at midday, so "in 3 days" counts days and a
        // row dated today never reads as hours ago.
        at: at.length === 10 ? `${at}T12:00:00.000Z` : at,
        link,
      })),
      detail: {},
      link,
    };
  }

  /**
   * A row's cell as card text: a select by its label, a checkbox as a mark.
   */
  protected text(
    column: FolioColumn | undefined,
    row: FolioRowResource,
  ): string {
    if (!column) return "";
    const value = row.cells[column.id] ?? null;
    if (this.codec.typeOf(column) === "checkbox")
      return value === true ? "✓" : "";
    return this.codec.displayText(column, value);
  }

  /**
   * A folio's Markdown cut at a heading or paragraph boundary, so a card
   * never ends mid-sentence; `cut` says whether there was more.
   */
  protected cutNote(folio: Folio): { markdown: string; cut: boolean } {
    const content = folio.content ?? "";
    if (content.length <= FolioCardMetric.NOTE_CHARS) {
      return { markdown: content || folio.summary, cut: false };
    }
    const blocks = content.split(/\n\s*\n/);
    let markdown = "";
    for (const block of blocks) {
      const next = markdown ? `${markdown}\n\n${block}` : block;
      if (next.length > FolioCardMetric.NOTE_CHARS) break;
      markdown = next;
    }
    return {
      markdown: markdown || content.slice(0, FolioCardMetric.NOTE_CHARS),
      cut: true,
    };
  }
}

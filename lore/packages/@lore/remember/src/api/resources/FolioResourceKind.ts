import {
  BoundParameters,
  ResourceRegistry,
  SearchPreview,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folios } from "../entities/folios.ts";
import { FolioSearchTerms } from "../services/FolioSearchTerms.ts";
import { FolioTableService } from "../services/FolioTableService.ts";

/**
 * The `folio` resource (`#F`), registered by Knowledge. Its stored id is a
 * UUID, which is what `folio_links.to_id` holds for it.
 */
export class FolioResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly folios = $repository(folios);
  protected readonly bound = $inject(BoundParameters);
  protected readonly search = $inject(SearchPreview);
  protected readonly tables = $inject(FolioTableService);
  protected readonly searchTerms = $inject(FolioSearchTerms);

  constructor() {
    this.resources.register({
      kind: "folio",
      letter: "F",
      order: 20,
      permission: "folio:read",
      page: {
        name: "projectFoliosFolio",
        params: (ref) => ({ shortId: ref.shortId }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.folios.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "shortId"],
        });
        return new Map(rows.map((r) => [r.shortId, r.id]));
      },
      // Scoped to the project: a folio id from elsewhere describes nothing.
      describe: async (projectId, ids) => {
        const rows = await this.bound.collect([...ids], (batch) =>
          this.folios.findMany({
            where: { id: { inArray: batch }, projectId: { eq: projectId } },
            columns: [
              "id",
              "shortId",
              "title",
              "summary",
              "updatedAt",
              "pinned",
            ],
          }),
        );
        return rows.map((r) => ({
          id: r.id,
          shortId: r.shortId,
          title: r.title,
          summary: r.summary,
          updatedAt: r.updatedAt,
          pinned: r.pinned,
        }));
      },
      search: {
        find: async ({ projectId, needle, number, limit }) => {
          const [rows, byRow] = await Promise.all([
            this.findByText(projectId, needle, number, limit),
            // A table is also found by its rows (#Q3514), once per folio,
            // with the matching row as its description.
            this.tables.searchRows(projectId, needle, limit),
          ]);
          const rowOf = new Map(byRow.map((hit) => [hit.folioId, hit]));
          const known = new Set(rows.map((row) => row.id));
          const missing = byRow
            .map((hit) => hit.folioId)
            .filter((id) => !known.has(id));
          const extra = missing.length
            ? await this.bound.collect(missing, (batch) =>
                this.folios.findMany({ where: { id: { inArray: batch } } }),
              )
            : [];
          return [...rows, ...extra].slice(0, limit).map((f) => {
            const hit = rowOf.get(f.id);
            return {
              kind: "folio" as const,
              id: f.id,
              shortId: f.shortId,
              title: f.title,
              description: this.search.preview(
                hit && !known.has(f.id)
                  ? `Row ${hit.number}: ${hit.text}`
                  : f.summary,
              ),
              protected: f.protected || undefined,
            };
          });
        },
      },
    });
  }

  /**
   * The folios whose own text, or number, matches.
   */
  protected async findByText(
    projectId: number,
    needle: string,
    number: number | undefined,
    limit: number,
  ) {
    const text = this.searchTerms.conditions("searchText", needle);
    if (text.length === 0 && number === undefined) return [];
    return this.folios.findMany({
      where: {
        projectId: { eq: projectId },
        ...(number === undefined
          ? { and: text }
          : {
              or: [
                { shortId: { eq: number } },
                ...(text.length ? [{ and: text }] : []),
              ],
            }),
      },
      limit,
    });
  }
}

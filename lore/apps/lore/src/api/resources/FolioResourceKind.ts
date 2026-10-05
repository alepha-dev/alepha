import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folios } from "../entities/folios.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import { ResourceRegistry } from "./ResourceRegistry.ts";
import { SearchPreview } from "./SearchPreview.ts";

/**
 * The `folio` resource (`#F`), registered by Knowledge. Its stored id is a
 * UUID, which is what `folio_links.to_id` holds for it.
 */
export class FolioResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly folios = $repository(folios);
  protected readonly bound = $inject(BoundParameters);
  protected readonly search = $inject(SearchPreview);

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
      describe: async (_projectId, ids) => {
        const rows = await this.bound.collect([...ids], (batch) =>
          this.folios.findMany({
            where: { id: { inArray: batch } },
            columns: ["id", "shortId", "title"],
          }),
        );
        return rows.map((r) => ({
          id: r.id,
          shortId: r.shortId,
          title: r.title,
        }));
      },
      search: {
        find: async ({ projectId, needle, number, limit }) => {
          const rows = await this.folios.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { searchText: { like: `%${needle}%` } }
                : {
                    or: [
                      { shortId: { eq: number } },
                      { searchText: { like: `%${needle}%` } },
                    ],
                  }),
            },
            limit,
          });
          return rows.map((f) => ({
            kind: "folio" as const,
            id: f.id,
            shortId: f.shortId,
            title: f.title,
            description: this.search.preview(f.summary),
            protected: f.protected || undefined,
          }));
        },
      },
    });
  }
}

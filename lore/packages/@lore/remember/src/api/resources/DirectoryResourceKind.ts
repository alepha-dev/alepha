import { ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folioDirectories } from "../entities/folioDirectories.ts";
import { FolioSearchTerms } from "../services/FolioSearchTerms.ts";

/**
 * The `directory` resource, registered by Knowledge: found by the palette by
 * name or `shortId`, and never a `[[...]]` target, so it has no letter.
 */
export class DirectoryResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly directories = $repository(folioDirectories);
  protected readonly searchTerms = $inject(FolioSearchTerms);

  constructor() {
    this.resources.register({
      kind: "directory",
      order: 30,
      permission: "folio:read",
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const text = this.searchTerms.conditions("name", raw);
          if (text.length === 0 && number === undefined) return [];
          const rows = await this.directories.findMany({
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
          return rows.map((d) => ({
            kind: "directory" as const,
            id: d.id,
            shortId: d.shortId,
            title: d.name,
          }));
        },
      },
    });
  }
}

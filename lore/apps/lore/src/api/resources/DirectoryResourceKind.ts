import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folioDirectories } from "../entities/folioDirectories.ts";
import { ResourceRegistry } from "./ResourceRegistry.ts";

/**
 * The `directory` resource, registered by Knowledge: found by the palette by
 * name or `shortId`, and never a `[[...]]` target, so it has no letter.
 */
export class DirectoryResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly directories = $repository(folioDirectories);

  constructor() {
    this.resources.register({
      kind: "directory",
      order: 30,
      permission: "folio:read",
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const rows = await this.directories.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { name: { like: `%${raw}%` } }
                : {
                    or: [
                      { shortId: { eq: number } },
                      { name: { like: `%${raw}%` } },
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

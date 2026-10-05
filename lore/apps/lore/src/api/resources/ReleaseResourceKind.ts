import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { releases } from "../entities/releases.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import { ResourceRegistry } from "./ResourceRegistry.ts";

/**
 * The `release` resource (`#R`), registered by Work. Addressed by its
 * per-project `number`; its page by its TAG (`/releases/0.28.0`), which is why
 * a ref carries one.
 */
export class ReleaseResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly releases = $repository(releases);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    this.resources.register({
      kind: "release",
      letter: "R",
      order: 50,
      permission: "release:read",
      page: {
        name: "projectRelease",
        params: (ref) => ({ releaseTag: ref.tag ?? "" }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.releases.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "number"],
        });
        return new Map(rows.map((r) => [r.number, String(r.id)]));
      },
      describe: async (_projectId, ids) => {
        const rows = await this.bound.collect(
          ids
            .map((id) => Number.parseInt(id, 10))
            .filter((n) => Number.isFinite(n)),
          (batch) =>
            this.releases.findMany({
              where: { id: { inArray: batch } },
              columns: ["id", "number", "title", "tag"],
            }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.number,
          title: r.title,
          tag: r.tag,
        }));
      },
      search: {
        numberOnly: true,
        find: async ({ projectId, number }) => {
          if (number === undefined) return [];
          const rows = await this.releases.findMany({
            where: { projectId: { eq: projectId }, number: { eq: number } },
            limit: 1,
          });
          return rows.map((r) => ({
            kind: "release" as const,
            id: String(r.id),
            shortId: r.number,
            // The tag is how a release is named everywhere else (`0.28.0`),
            // and the title only where one was given beside it.
            title:
              r.tag && r.tag !== r.title ? `${r.tag} - ${r.title}` : r.title,
            tag: r.tag ?? undefined,
          }));
        },
      },
    });
  }
}

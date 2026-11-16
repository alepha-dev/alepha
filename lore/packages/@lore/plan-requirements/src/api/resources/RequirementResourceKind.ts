import { BoundParameters, ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { requirements } from "../entities/requirements.ts";

/**
 * The `requirement` resource (`#S`, #E153), registered by Plan's Requirements:
 * what makes `[[#S15]]` resolve in a quest, an epic or a folio, and what lets
 * the palette find a requirement by number or by statement.
 */
export class RequirementResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly requirements = $repository(requirements);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    this.resources.register({
      kind: "requirement",
      letter: "S",
      order: 62,
      permission: "requirement:read",
      page: {
        name: "projectRequirements",
        // The Requirements tab with this requirement's detail pane open.
        params: () => ({}),
        query: (ref) => ({ requirement: String(ref.shortId) }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.requirements.findMany({
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
            this.requirements.findMany({
              where: { id: { inArray: batch } },
              columns: ["id", "number", "statement"],
            }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.number,
          title: r.statement,
        }));
      },
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const rows = await this.requirements.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { statement: { ilike: `%${raw}%` } }
                : {
                    or: [
                      { number: { eq: number } },
                      { statement: { ilike: `%${raw}%` } },
                    ],
                  }),
            },
            limit,
          });
          return rows.map((p) => ({
            kind: "requirement" as const,
            id: String(p.id),
            shortId: p.number,
            title: p.statement,
          }));
        },
      },
    });
  }
}

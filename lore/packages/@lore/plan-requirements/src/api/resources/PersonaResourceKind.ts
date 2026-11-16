import { BoundParameters, ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";

/**
 * The `persona` resource (`#A`, #E153), registered by Plan's Requirements:
 * what makes `[[#A2]]` resolve in a quest, an epic or a folio, and what lets
 * the palette find a persona by number or by name.
 */
export class PersonaResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly personas = $repository(personas);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    this.resources.register({
      kind: "persona",
      letter: "A",
      order: 60,
      permission: "persona:read",
      page: {
        name: "projectPersona",
        params: (ref) => ({ personaNumber: ref.shortId }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.personas.findMany({
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
            this.personas.findMany({
              where: { id: { inArray: batch } },
              columns: ["id", "number", "name"],
            }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.number,
          title: r.name,
        }));
      },
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const rows = await this.personas.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { name: { ilike: `%${raw}%` } }
                : {
                    or: [
                      { number: { eq: number } },
                      { name: { ilike: `%${raw}%` } },
                    ],
                  }),
            },
            limit,
          });
          return rows.map((p) => ({
            kind: "persona" as const,
            id: String(p.id),
            shortId: p.number,
            title: p.name,
          }));
        },
      },
    });
  }
}

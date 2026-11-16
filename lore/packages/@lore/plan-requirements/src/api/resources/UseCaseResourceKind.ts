import { BoundParameters, ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { useCases } from "../entities/useCases.ts";

/**
 * The `usecase` resource (`#U`, #E153), registered by Plan's Requirements:
 * what makes `[[#U7]]` resolve in a quest, an epic or a folio, and what lets
 * the palette find a use case by number or by title.
 */
export class UseCaseResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly useCases = $repository(useCases);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    this.resources.register({
      kind: "usecase",
      letter: "U",
      order: 61,
      permission: "usecase:read",
      page: {
        name: "projectUseCase",
        params: (ref) => ({ useCaseNumber: ref.shortId }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.useCases.findMany({
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
            this.useCases.findMany({
              where: { id: { inArray: batch } },
              columns: ["id", "number", "title", "status"],
            }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.number,
          title: r.title,
          status: r.status,
        }));
      },
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const rows = await this.useCases.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { title: { ilike: `%${raw}%` } }
                : {
                    or: [
                      { number: { eq: number } },
                      { title: { ilike: `%${raw}%` } },
                    ],
                  }),
            },
            limit,
          });
          return rows.map((p) => ({
            kind: "usecase" as const,
            id: String(p.id),
            shortId: p.number,
            title: p.title,
          }));
        },
      },
    });
  }
}

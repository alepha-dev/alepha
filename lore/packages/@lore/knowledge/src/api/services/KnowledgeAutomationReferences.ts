import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folios } from "../entities/folios.ts";

/**
 * This module owns its automation reference checks; every lookup includes projectId.
 */
export class KnowledgeAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly folios = $repository(folios);
  constructor() {
    this.references.registerOptions("folio", {
      permission: "folio:read",
      read: async ({ projectId, offset, limit, search, ids }) => {
        const rows = await this.folios.findMany({
          where: {
            projectId,
            ...(ids ? { id: { inArray: ids } } : {}),
            ...(search ? { title: { contains: search } } : {}),
          },
          columns: ["id", "title"],
          orderBy: [
            { column: "title", direction: "asc" },
            { column: "id", direction: "asc" },
          ],
          offset,
          limit: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((row) => ({ value: row.id, label: row.title.slice(0, 255) })),
          hasMore: rows.length > limit,
        };
      },
    });
    this.references.register("folio", async (projectId, value) =>
      typeof value === "string" &&
      (
        await this.folios.findMany({
          where: { id: value, projectId },
          columns: ["id"],
          limit: 1,
        })
      ).length
        ? undefined
        : "Folio does not exist in this project",
    );
  }
}

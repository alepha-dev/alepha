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

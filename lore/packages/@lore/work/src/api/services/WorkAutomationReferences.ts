import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

/**
 * This module owns its automation reference checks; every lookup includes projectId.
 */
export class WorkAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly releases = $repository(releases);
  protected readonly quests = $repository(quests);
  constructor() {
    this.references.register("release", async (projectId, value) => {
      if (typeof value !== "number")
        return "Release must be a stable numeric ID";
      const [row] = await this.releases.findMany({
        where: { id: value, projectId },
        columns: ["id", "releasedAt"],
        limit: 1,
      });
      return !row
        ? "Release does not exist in this project"
        : row.releasedAt
          ? "Release is published"
          : undefined;
    });
    this.references.register("quest", async (projectId, value) => {
      if (typeof value !== "number") return "Quest must be a stable numeric ID";
      return (
        await this.quests.findMany({
          where: { id: value, projectId },
          columns: ["id"],
          limit: 1,
        })
      ).length
        ? undefined
        : "Quest does not exist in this project";
    });
  }
}

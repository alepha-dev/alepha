import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

/**
 * This module owns its automation reference checks; every lookup includes projectId.
 */
export class WorkAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly releases = $repository(releases);
  protected readonly epics = $repository(epics);
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);
  constructor() {
    this.references.registerOptions("quest", {
      permission: "quest:read",
      read: async ({ projectId, offset, limit }) => {
        const rows = await this.quests.findMany({
          where: { projectId },
          columns: ["id", "shortId", "title"],
          orderBy: { column: "id", direction: "desc" },
          offset,
          limit: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map((row) => ({
            value: String(row.id),
            label: `#Q${row.shortId}: ${row.title}`.slice(0, 255),
          })),
          hasMore: rows.length > limit,
        };
      },
    });

    this.references.registerOptions("release", {
      permission: "release:read",
      read: async ({ projectId, offset, limit }) => {
        const rows = await this.releases.findMany({
          where: { projectId },
          columns: ["id", "tag", "title"],
          orderBy: { column: "id", direction: "desc" },
          offset,
          limit: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map((row) => ({
            value: String(row.id),
            label: `${row.tag}: ${row.title}`.slice(0, 255),
          })),
          hasMore: rows.length > limit,
        };
      },
    });

    this.references.registerOptions("epic", {
      permission: "epic:read",
      read: async ({ projectId, offset, limit }) => {
        const rows = await this.epics.findMany({
          where: { projectId },
          columns: ["id", "number", "title"],
          orderBy: { column: "id", direction: "desc" },
          offset,
          limit: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map((row) => ({
            value: String(row.id),
            label: `#E${row.number}: ${row.title}`.slice(0, 255),
          })),
          hasMore: rows.length > limit,
        };
      },
    });

    this.references.registerOptions("feedback", {
      permission: "feedback:read",
      read: async ({ projectId, offset, limit }) => {
        const rows = await this.feedback.findMany({
          where: { projectId },
          columns: ["id", "shortId", "title"],
          orderBy: { column: "id", direction: "desc" },
          offset,
          limit: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map((row) => ({
            value: String(row.id),
            label: `#P${row.shortId}: ${row.title}`.slice(0, 255),
          })),
          hasMore: rows.length > limit,
        };
      },
    });

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

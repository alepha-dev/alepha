import { AutomationEventSubjects } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

/**
 * Prospective means a simulation of the declared transition on today's row.
 * It neither completes work nor publishes or regenerates release content.
 */
export class WorkAutomationEventSubjects {
  protected readonly registry = $inject(AutomationEventSubjects);
  protected readonly projects = $repository(projects);
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
  constructor() {
    for (const key of [
      "feedback.created",
      "quest.completed",
      "epic.completed",
      "release.published",
    ])
      this.registry.register(key, (projectId, id) =>
        this.subject(key, projectId, id),
      );
  }
  protected async subject(key: string, projectId: number, id: string | number) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)
      throw new BadRequestError(
        "Work event subjects require a numeric global resource ID",
      );
    const project = await this.projects.getById(projectId);
    const path = `/${project.slug || `project-${project.id}`}`;
    if (key === "feedback.created") {
      const row = await this.feedback.getOne({ where: { projectId, id } });
      return {
        title: row.title,
        feedback_id: row.id,
        shortId: row.shortId,
        url: `${path}/feedback`,
      };
    }
    if (key === "quest.completed") {
      const row = await this.quests.getOne({ where: { projectId, id } });
      return {
        title: row.title,
        quest_id: row.id,
        shortId: row.shortId,
        url: `${path}/quests/${row.shortId}`,
      };
    }
    if (key === "epic.completed") {
      const row = await this.epics.getOne({ where: { projectId, id } });
      return {
        title: row.title,
        epic_id: row.id,
        shortId: row.number,
        quest_count: await this.quests.count({ projectId, epicId: row.id }),
        url: `${path}/epics/${row.number}`,
      };
    }
    const row = await this.releases.getOne({ where: { projectId, id } });
    return {
      title: row.title ?? row.tag ?? String(row.number),
      release_id: row.id,
      release_tag: row.tag ?? String(row.number),
      changelog: row.changelog ?? "",
      quest_count: await this.quests.count({ projectId, releaseId: row.id }),
      url: `${path}/releases/${encodeURIComponent(row.tag ?? String(row.number))}`,
    };
  }
}

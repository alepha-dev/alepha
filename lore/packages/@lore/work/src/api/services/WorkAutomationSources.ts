import { AutomationSourceRepository } from "@lore/core/api";
import { projects, type Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";

import { epics, type Epic } from "../entities/epics.ts";
import { feedback, type FeedbackInsert } from "../entities/feedback.ts";
import { quests, type Quest } from "../entities/quests.ts";
import { releases, type Release } from "../entities/releases.ts";

/**
 * Event projections belong to Work. Controllers retain their ordinary audits,
 * mention handling and workflow tail after this atomic domain write.
 */
export class WorkAutomationSources {
  protected readonly projects = $repository(projects);
  protected readonly feedback = $inject(
    AutomationSourceRepository.of(feedback),
  );
  protected readonly releases = $inject(
    AutomationSourceRepository.of(releases),
  );
  protected readonly quests = $inject(AutomationSourceRepository.of(quests));
  protected readonly epics = $inject(AutomationSourceRepository.of(epics));

  public async submit(data: FeedbackInsert) {
    const project = await this.projects.getById(data.projectId);
    return this.feedback.sourceCreate(
      data,
      { projectId: data.projectId, shortId: data.shortId },
      {
        projectId: data.projectId,
        name: "feedback.created",
        identity: `feedback:${data.projectId}:${data.shortId}`,
        generatedIdField: "feedback_id",
        fields: {
          project: project.title,
          title: data.title,
          shortId: data.shortId,
          url: `/${project.slug || `project-${project.id}`}/feedback`,
        },
      },
    );
  }
  public async publish(
    release: Release,
    patch: Parameters<typeof this.releases.updateOne>[1],
    publisherId: string,
    questCount: number,
  ) {
    const project = await this.projects.getById(release.projectId);
    return this.releases.sourceUpdate(
      {
        id: release.id,
        releasedAt: { isNull: true },
        updatedAt: release.updatedAt,
      },
      patch,
      {
        projectId: release.projectId,
        name: "release.published",
        identity: `release:${release.id}:${crypto.randomUUID()}`,
        resourceId: release.id,
        fields: {
          project: project.title,
          title:
            patch.title ??
            release.title ??
            release.tag ??
            String(release.number),
          release_id: release.id,
          release_tag: release.tag ?? String(release.number),
          publisher_id: publisherId,
          changelog: patch.changelog,
          quest_count: questCount,

          url: `/${project.slug || `project-${project.id}`}/releases/${encodeURIComponent(release.tag ?? String(release.number))}`,
        },
      },
    );
  }
  public async completeQuest(quest: Quest, knownProject?: Project) {
    const project =
      knownProject ?? (await this.projects.getById(quest.projectId));
    await this.quests.sourceSave(quest, {
      projectId: quest.projectId,
      name: "quest.completed",
      identity: `quest:${quest.id}:completed`,
      fields: {
        project: project.title,
        title: quest.title,
        quest_id: quest.id,
        shortId: quest.shortId,
        url: `/${project.slug || `project-${project.id}`}/quests/${quest.shortId}`,
      },
    });
  }
  public async completeEpic(
    epic: Epic,
    where: Parameters<typeof this.epics.updateOne>[0],
    completedAt: string,
    knownProject?: Project,
  ) {
    const id = epic.id;
    const project =
      knownProject ?? (await this.projects.getById(epic.projectId));
    return this.epics.sourceUpdate(
      where,
      { status: "completed", completedAt },
      {
        projectId: epic.projectId,
        name: "epic.completed",
        numbers: {
          quest_count: sql`(SELECT COUNT(*) FROM quests WHERE epic_id = ${id} AND deleted_at IS NULL)`,
        },
        identity: `epic:${id}:completed`,
        resourceId: id,
        fields: {
          project: project.title,
          title: epic.title,
          epic_id: epic.id,
          shortId: epic.number,

          url: `/${project.slug || `project-${project.id}`}/epics/${epic.number}`,
        },
      },
    );
  }
}

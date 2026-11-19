import { SourceRepository } from "@lore/core/api";
import { projects, type Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";

import { epics, type Epic } from "../entities/epics.ts";
import { feedback, type FeedbackInsert } from "../entities/feedback.ts";
import { quests, type Quest } from "../entities/quests.ts";
import { releases, type Release } from "../entities/releases.ts";
import { FeedbackEventFields } from "./FeedbackEventFields.ts";
import { WorkProjectEvents } from "./WorkProjectEvents.ts";

/**
 * Event projections belong to Work. Controllers retain their ordinary audits,
 * mention handling and workflow tail after this atomic domain write.
 */
export class WorkEventSources {
  /**
   * Injected so the events this class records are in the catalog
   * whatever booted it (#Q3889).
   */
  protected readonly eventDefinitions = $inject(WorkProjectEvents);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly feedbackFields = $inject(FeedbackEventFields);
  protected readonly projects = $repository(projects);
  protected readonly feedback = $inject(SourceRepository.of(feedback));
  protected readonly releases = $inject(SourceRepository.of(releases));
  protected readonly quests = $inject(SourceRepository.of(quests));
  protected readonly epics = $inject(SourceRepository.of(epics));

  public async submit(data: FeedbackInsert) {
    const project = await this.projects.getById(data.projectId);
    return this.feedback.sourceCreate(
      data,
      { projectId: data.projectId, shortId: data.shortId },
      {
        projectId: data.projectId,
        name: "feedback.created",
        subjectId: data.shortId,
        generatedIdField: "feedback_id",
        fields: {
          project: project.title,
          title: data.title,
          shortId: data.shortId,
          ...this.feedbackFields.build(
            `/${project.slug || `project-${project.id}`}`,
            {
              shortId: data.shortId,
              description: data.description ?? "",
            },
          ),
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
        subjectId: release.number,
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
      subjectId: quest.shortId,
      fields: {
        project: project.title,
        title: quest.title,
        quest_id: quest.id,
        shortId: quest.shortId,
        area: quest.area,
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
        subjectId: epic.number,
        numbers: {
          quest_count: this.quests.subquery({ epicId: id }, undefined, {
            count: true,
          }),
        },
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

import { SourceRepository } from "@lore/core/api";
import { type Project, projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { type Quest, quests } from "../entities/quests.ts";
import { WorkProjectEvents } from "./WorkProjectEvents.ts";

/**
 * The quest writes that record a project event with them (#Q3889):
 * `quest.created`, `quest.assigned` and `quest.held`, each in the guarded
 * batch of its write. A plain edit goes through the ordinary repository and
 * records nothing.
 */
export class QuestEventSources {
  /**
   * Injected so the events this class records are in the catalog
   * whatever booted it (#Q3889).
   */
  protected readonly eventDefinitions = $inject(WorkProjectEvents);
  protected readonly projects = $repository(projects);
  protected readonly sources = $inject(SourceRepository.of(quests));

  public async create(
    data: Parameters<typeof this.sources.create>[0],
    actorId: string | undefined,
  ): Promise<Quest> {
    const project = await this.projects.getById(data.projectId);
    return this.sources.sourceCreate(
      data,
      { projectId: data.projectId, shortId: data.shortId },
      {
        projectId: data.projectId,
        name: "quest.created",
        identity: `quest:${data.projectId}:${data.shortId}:created`,
        subjectId: data.shortId,
        generatedIdField: "quest_id",
        fields: {
          ...this.common(project, data),
          actor_id: actorId ?? null,
        },
      },
    );
  }

  /**
   * Saves an accepted or assigned quest, with `quest.assigned`: every accept
   * fires it, an agent's included.
   */
  public async assigned(quest: Quest, project: Project, actorId: string) {
    await this.sources.sourceSave(quest, {
      projectId: quest.projectId,
      name: "quest.assigned",
      identity: `quest:${quest.id}:assigned:${quest.version}`,
      subjectId: quest.shortId,
      fields: {
        ...this.common(project, quest),
        quest_id: quest.id,
        actor_id: actorId,
        assignee_id: quest.acceptedBy ?? null,
      },
    });
  }

  /**
   * Saves a quest put on hold, with `quest.held`.
   */
  public async held(quest: Quest, project: Project, actorId: string) {
    await this.sources.sourceSave(quest, {
      projectId: quest.projectId,
      name: "quest.held",
      identity: `quest:${quest.id}:held:${quest.version}`,
      subjectId: quest.shortId,
      fields: {
        ...this.common(project, quest),
        quest_id: quest.id,
        actor_id: actorId,
      },
    });
  }

  protected common(
    project: Pick<Project, "id" | "slug" | "title">,
    quest: { shortId: number; title: string; area?: string | null },
  ) {
    return {
      project: project.title,
      title: quest.title,
      shortId: quest.shortId,
      area: quest.area ?? "",
      url: `/${project.slug || `project-${project.id}`}/quests/${quest.shortId}`,
    };
  }
}

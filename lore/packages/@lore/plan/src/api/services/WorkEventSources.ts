import {
  LoreDatabase,
  ProjectEvents,
  projectEvents,
  SourceRepository,
} from "@lore/core/api";
import { projects, type Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";

import { epics, type Epic } from "../entities/epics.ts";
import {
  type Feedback,
  feedback,
  type FeedbackInsert,
} from "../entities/feedback.ts";
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
  protected readonly events = $repository(projectEvents);
  protected readonly projectEvents = $inject(ProjectEvents);
  protected readonly database = $inject(LoreDatabase);

  /**
   * A new epic, with `epic.created` (#Q4276).
   */
  public async createEpic(
    data: Parameters<typeof this.epics.create>[0],
    actorId?: string,
  ): Promise<Epic> {
    const project = await this.projects.getById(data.projectId);
    return this.epics.sourceCreate(
      data,
      { projectId: data.projectId, number: data.number },
      {
        projectId: data.projectId,
        name: "epic.created",
        subjectId: data.number,
        ...(actorId ? { actorId } : {}),
        generatedIdField: "epic_id",
        fields: {
          project: project.title,
          title: data.title,
          shortId: data.number,
          ...(actorId ? { actor_id: actorId } : {}),
          url: `/${project.slug || `project-${project.id}`}/epics/${data.number}`,
        },
      },
    );
  }

  /**
   * An epic moved to a status by hand, with `epic.ready` when it is marked
   * ready (#Q4276), by the page or a tool.
   */
  public async setEpicStatus(
    epic: Epic,
    status: Epic["status"],
    actorId?: string,
  ): Promise<Epic> {
    if (status !== "ready") {
      return this.epics.updateById(epic.id, { status });
    }
    const project = await this.projects.getById(epic.projectId);
    return this.epics.sourceUpdate(
      { id: epic.id, status: epic.status },
      { status },
      {
        projectId: epic.projectId,
        name: "epic.ready",
        subjectId: epic.number,
        ...(actorId ? { actorId } : {}),
        fields: {
          project: project.title,
          title: epic.title,
          epic_id: epic.id,
          shortId: epic.number,
          ...(actorId ? { actor_id: actorId } : {}),
          url: `/${project.slug || `project-${project.id}`}/epics/${epic.number}`,
        },
      },
    );
  }

  /**
   * A pull request recorded on a quest or an epic, with `pull_request.added`
   * the first time the project records it (#Q4276).
   */
  public async addPullRequest(
    target: { kind: "quest"; row: Quest } | { kind: "epic"; row: Epic },
    pullRequests: NonNullable<Quest["pullRequests"]>,
    url: string,
    actorId?: string,
    options: { silent?: boolean } = {},
  ): Promise<Quest | Epic> {
    const { row } = target;
    const already = (row.pullRequests ?? []).some((it) => it.url === url);
    const seen = already || (await this.recorded(row.projectId, url));
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
    // A backfill at connect attaches with no event (the epic review's answer
    // to item 26 of #E177): history must not start review-pr on every pull
    // request a project ever had.
    if (seen || !number || options.silent) {
      return target.kind === "quest"
        ? this.quests.updateById(row.id, { pullRequests })
        : this.epics.updateById(row.id, { pullRequests });
    }
    const project = await this.projects.getById(row.projectId);
    const slug = project.slug || `project-${project.id}`;
    const event = {
      projectId: row.projectId,
      name: "pull_request.added",
      subjectId: number,
      ...(actorId ? { actorId } : {}),
      fields: {
        project: project.title,
        title: row.title,
        number,
        repository: url.replace(/\/pull\/\d+.*$/, ""),
        pull_request_url: url,
        ...(target.kind === "quest"
          ? { quest_shortId: target.row.shortId }
          : { epic_number: target.row.number }),
        ...(actorId ? { actor_id: actorId } : {}),
        url:
          target.kind === "quest"
            ? `/${slug}/quests/${target.row.shortId}`
            : `/${slug}/epics/${target.row.number}`,
      },
    };
    return target.kind === "quest"
      ? this.quests.sourceUpdate({ id: row.id }, { pullRequests }, event)
      : this.epics.sourceUpdate({ id: row.id }, { pullRequests }, event);
  }

  /**
   * Whether the project raised `pull_request.added` for this URL already,
   * in the events it keeps.
   */
  protected async recorded(projectId: number, url: string): Promise<boolean> {
    const rows = await this.events.findMany({
      where: {
        projectId: { eq: projectId },
        name: { eq: "pull_request.added" },
      },
      orderBy: [{ column: "occurredAt", direction: "desc" }],
      limit: 500,
    });
    return rows.some((it) => it.fields.pull_request_url === url);
  }

  public async submit(data: FeedbackInsert) {
    const project = await this.projects.getById(data.projectId);
    return this.feedback.sourceCreate(
      data,
      { projectId: data.projectId, shortId: data.shortId },
      {
        projectId: data.projectId,
        name: "feedback.created",
        subjectId: data.shortId,
        ...(data.reporterUserId ? { actorId: data.reporterUserId } : {}),
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
  /**
   * A member trusts an item written outside the team (#Q4216), and
   * `feedback.trusted` is recorded with it (#Q4227), so a triage automation
   * reads it without waiting for the next feedback or the next tick. The
   * guard is the item still untrusted.
   */
  public async trustFeedback(
    item: Feedback,
    trustedBy: string,
    trustedAt: string,
  ) {
    const project = await this.projects.getById(item.projectId);
    const path = `/${project.slug || `project-${project.id}`}`;
    const fields = this.feedbackFields.build(path, {
      shortId: item.shortId,
      description: "",
    });
    return this.feedback.sourceUpdate(
      { id: item.id, trustedAt: { isNull: true } },
      { trustedAt, trustedBy },
      {
        projectId: item.projectId,
        name: "feedback.trusted",
        subjectId: item.shortId,
        resourceId: item.id,
        actorId: trustedBy,
        fields: {
          project: project.title,
          title: item.title,
          feedback_id: item.id,
          shortId: item.shortId,
          reference: fields.reference,
          trusted_by: trustedBy,
          url: fields.url,
        },
      },
    );
  }
  /**
   * `feedback.commented` for a comment just written (#Q4331), so a triage
   * trigger hears a discussion that moved. Recorded after the comment, not
   * with it: a comment is no transition a guard could lose, and its event
   * is a notice, not a fact a later write depends on.
   */
  public async commentFeedback(item: Feedback, authorId: string) {
    const project = await this.projects.getById(item.projectId);
    const fields = this.feedbackFields.build(
      `/${project.slug || `project-${project.id}`}`,
      { shortId: item.shortId, description: "" },
    );
    const recorded = await this.projectEvents.emit({
      projectId: item.projectId,
      name: "feedback.commented",
      subjectId: item.shortId,
      actorId: authorId,
      fields: {
        project: project.title,
        title: item.title,
        feedback_id: item.id,
        shortId: item.shortId,
        reference: fields.reference,
        author_id: authorId,
        url: fields.url,
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
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

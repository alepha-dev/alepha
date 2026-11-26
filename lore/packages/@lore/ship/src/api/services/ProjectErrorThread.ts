import {
  BestEffort,
  BoundParameters,
  CommentService,
  HostJobs,
  ResourceRegistry,
} from "@lore/core/api";
import type { Comment } from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import {
  type ProjectErrorEvent,
  projectErrorEvents,
} from "../entities/projectErrorEvents.ts";
import type { ProjectError } from "../entities/projectErrors.ts";
import type { ProjectErrorEventKind } from "../schemas/projectErrorEventKindSchema.ts";
import type { ProjectErrorThreadEntry } from "../schemas/projectErrorThreadEntrySchema.ts";
import type { ProjectErrorThreadJob } from "../schemas/projectErrorThreadJobSchema.ts";
import { ProjectErrorAccess } from "./ProjectErrorAccess.ts";

/**
 * An error's thread (#E185): the comments members and agents write on it,
 * and one event each time its triage state changes. Two stores read as one:
 * the comments are rows of core's `comments` under the `error` subject, the
 * events are Ship's `project_error_events`.
 *
 * Permissions and the agent gate are the controller's
 * (`ProjectErrorThreadController`); this holds the reads and the writes.
 */
export class ProjectErrorThread {
  /**
   * The value of `comments.subjectType` for an error's comments.
   */
  public static readonly SUBJECT = "error";

  protected readonly comments = $inject(CommentService);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly access = $inject(ProjectErrorAccess);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly bound = $inject(BoundParameters);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly events = $repository(projectErrorEvents);
  protected readonly users = $repository(users);

  constructor() {
    // `load` is the cross-project guard of every comment written here: the
    // error of that project, or its 404.
    this.comments.registerSubject({
      type: ProjectErrorThread.SUBJECT,
      load: (projectId, errorId) => this.access.load(projectId, errorId),
    });
  }

  /**
   * Record a change of triage state, after the change itself.
   *
   * ⚠️ Never thrown, and never rolled back into a refused verb: there is no
   * transaction (D1), the status has already changed, and an error resolved
   * with a missing line in its history is still resolved. The failure is
   * logged at error level, so it reaches the errors inbox.
   */
  public async record(
    errorId: number,
    kind: ProjectErrorEventKind,
    details: { actorId?: string; questId?: number } = {},
  ): Promise<void> {
    await this.bestEffort.run(`Recording the '${kind}' event of an error`, () =>
      this.events.create({
        projectErrorId: errorId,
        kind,
        ...(details.actorId ? { actorId: details.actorId } : {}),
        ...(details.questId !== undefined ? { questId: details.questId } : {}),
      }),
    );
  }

  /**
   * The thread, oldest first: the error's comments and its events, two
   * statements issued together and merged by time, never one per entry.
   * The names and the quests they point at are one statement each.
   */
  public async list(
    error: ProjectError,
    options: {
      /**
       * Whether the caller is shown the quests the events point at
       * (`ProjectErrorAccess.questsReadable`).
       */
      quests: boolean;
    },
  ): Promise<ProjectErrorThreadEntry[]> {
    const [comments, events] = await Promise.all([
      this.comments.list(ProjectErrorThread.SUBJECT, error.id),
      this.events.findMany({
        where: { projectErrorId: { eq: error.id } },
        orderBy: [
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
      }),
    ]);
    const [names, quests] = await Promise.all([
      this.names([
        ...comments.map((comment) => comment.authorId),
        ...events.map((event) => event.actorId),
      ]),
      options.quests
        ? this.quests(
            error.projectId,
            events.map((event) => event.questId),
          )
        : new Map<number, { shortId: number; title: string }>(),
    ]);
    return [
      ...events.map((event) => this.eventEntry(event, names, quests)),
      ...comments.map((comment) => this.commentEntry(comment, names)),
    ].sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        // At the same instant the change comes before what was said of it.
        Number(a.type === "comment") - Number(b.type === "comment") ||
        a.id - b.id,
    );
  }

  /**
   * The agent runs on an error that have not answered (#Q4471): queued,
   * running, or ended without an answer (failed, timed out), oldest first.
   * A run that succeeded left its comment, a cancelled one was stopped by a
   * member: neither shows.
   */
  public async jobs(error: ProjectError): Promise<ProjectErrorThreadJob[]> {
    const jobs = await this.hostJobs.ofSubject(
      error.projectId,
      ProjectErrorThread.SUBJECT,
      String(error.id),
    );
    const shown: ProjectErrorThreadJob[] = [];
    for (const job of jobs) {
      if (
        job.status !== "queued" &&
        job.status !== "running" &&
        job.status !== "failed" &&
        job.status !== "timed_out"
      ) {
        continue;
      }
      shown.push({
        id: job.id,
        status: job.status,
        ...(job.prompt ? { prompt: job.prompt } : {}),
        queuedAt: job.queuedAt,
        ...(job.startedAt ? { startedAt: job.startedAt } : {}),
        ...(job.endedAt ? { endedAt: job.endedAt } : {}),
      });
    }
    return shown.toReversed();
  }

  /**
   * One comment as the thread shows it.
   */
  public async entryOf(comment: Comment): Promise<ProjectErrorThreadEntry> {
    return this.commentEntry(comment, await this.names([comment.authorId]));
  }

  /**
   * Remove the comments of deleted errors, by hand: core's table has no
   * cascade from an error. The events go with the row, by their foreign key.
   * After the delete, and best effort: an error that is gone must not come
   * back as a failed request because its thread could not be swept.
   */
  public async deleteFor(errorIds: readonly number[]): Promise<void> {
    if (errorIds.length === 0) return;
    await this.bestEffort.run("Deleting the comments of deleted errors", () =>
      this.comments.deleteForSubjects(ProjectErrorThread.SUBJECT, errorIds),
    );
  }

  protected commentEntry(
    comment: Comment,
    names: Map<string, string>,
  ): ProjectErrorThreadEntry {
    return {
      type: "comment",
      id: comment.id,
      at: comment.createdAt,
      ...this.who(comment.authorId, names),
      body: comment.body,
      ...(comment.editedAt ? { editedAt: comment.editedAt } : {}),
      ...(comment.source ? { source: comment.source } : {}),
    };
  }

  protected eventEntry(
    event: ProjectErrorEvent,
    names: Map<string, string>,
    quests: Map<number, { shortId: number; title: string }>,
  ): ProjectErrorThreadEntry {
    return {
      type: "event",
      id: event.id,
      at: event.createdAt,
      ...this.who(event.actorId, names),
      kind: event.kind,
      ...(event.questId != null
        ? { quest: { id: event.questId, ...quests.get(event.questId) } }
        : {}),
    };
  }

  protected who(
    userId: string | null | undefined,
    names: Map<string, string>,
  ): { userId?: string; userName?: string } {
    if (!userId) return {};
    const name = names.get(userId);
    return { userId, ...(name ? { userName: name } : {}) };
  }

  /**
   * The display names of these accounts, by id, as the quest and feedback
   * threads show them (first and last name, else the handle, else the
   * e-mail). An account with none of them has no entry.
   */
  protected async names(
    ids: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const found = await this.bound.collect(unique, (batch) =>
      this.users.findMany({ where: { id: { inArray: batch } } }),
    );
    return new Map(found.map((it) => [it.id, displayName(it, "")]));
  }

  /**
   * The quests these events point at, through the `quest` kind of the
   * resources registry (#E75). Nothing while no module registers it; a
   * deleted quest is simply absent.
   */
  protected async quests(
    projectId: number,
    ids: ReadonlyArray<number | null | undefined>,
  ): Promise<Map<number, { shortId: number; title: string }>> {
    const unique = [
      ...new Set(ids.filter((id): id is number => id != null)),
    ].map(String);
    const refs = await this.resources.describe("quest", projectId, unique);
    return new Map(
      refs.map((ref) => [
        Number(ref.id),
        { shortId: ref.shortId, title: ref.title },
      ]),
    );
  }
}

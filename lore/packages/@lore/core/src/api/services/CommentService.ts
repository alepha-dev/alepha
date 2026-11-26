import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { type Comment, comments } from "../entities/comments.ts";
import type { CommentSource } from "../schemas/commentSourceSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";

/**
 * The threads of core's `comments` table (#E185): one service for every
 * subject a package registers.
 *
 * - **A subject is registered by the package that owns it**, at start, the
 *   way a prompt arg is (`PromptRegistry.registerArg`). Its `load` answers
 *   the subject in a project or throws the 404: it is the cross-project
 *   guard, so a `subjectId` is never trusted on its own.
 * - **No permission is checked here.** Each package's controller gates its
 *   own routes (a feedback thread is open to a reporter who is no member),
 *   and core has no comment route.
 * - **Nothing cascades from a subject**: its delete calls
 *   `deleteForSubjects` in the same code path.
 */
export class CommentService {
  protected readonly comments = $repository(comments);
  protected readonly bounds = $inject(BoundParameters);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly subjects = new Map<string, CommentSubject>();

  public registerSubject(subject: CommentSubject): void {
    if (this.subjects.has(subject.type)) {
      throw new AlephaError(
        `Comment subject '${subject.type}' is registered twice`,
      );
    }
    this.subjects.set(subject.type, subject);
  }

  public types(): string[] {
    return [...this.subjects.keys()];
  }

  /**
   * The subject in this project, as its package loads it, or its 404.
   */
  public async load(
    type: string,
    projectId: number,
    subjectId: number,
  ): Promise<unknown> {
    return await this.subject(type).load(projectId, subjectId);
  }

  /**
   * One thread, oldest first. The caller has loaded the subject: this reads
   * by `(subjectType, subjectId)` alone.
   */
  public async list(type: string, subjectId: number): Promise<Comment[]> {
    this.subject(type);
    return await this.comments.findMany({
      where: { subjectType: { eq: type }, subjectId: { eq: subjectId } },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * One comment of a subject, or a 404: an id of another thread is not
   * found, never confirmed.
   */
  public async get(
    type: string,
    subjectId: number,
    id: number,
  ): Promise<Comment> {
    const comment = await this.comments.findOne({
      where: {
        id: { eq: id },
        subjectType: { eq: type },
        subjectId: { eq: subjectId },
      },
    });
    if (!comment) {
      throw new NotFoundError("Comment not found");
    }
    return comment;
  }

  /**
   * Write a comment on a subject of this project. The subject is loaded
   * first, so one of another project is refused with its package's 404.
   */
  public async add(options: {
    type: string;
    projectId: number;
    subjectId: number;
    authorId: string;
    body: string;
    attachments?: string[];
    source?: CommentSource;
  }): Promise<Comment> {
    await this.load(options.type, options.projectId, options.subjectId);
    return await this.comments.create({
      projectId: options.projectId,
      subjectType: options.type,
      subjectId: options.subjectId,
      authorId: options.authorId,
      body: options.body,
      ...(options.attachments?.length
        ? { attachments: options.attachments }
        : {}),
      ...(options.source ? { source: options.source } : {}),
    });
  }

  /**
   * Rewrite a comment, and say it was edited.
   */
  public async edit(
    id: number,
    changes: { body: string; attachments?: string[] },
  ): Promise<Comment> {
    return await this.comments.updateById(id, {
      body: changes.body,
      ...(changes.attachments ? { attachments: changes.attachments } : {}),
      editedAt: this.dateTime.nowISOString(),
    });
  }

  public async remove(id: number): Promise<void> {
    await this.comments.deleteById(id);
  }

  /**
   * Remove the threads of deleted subjects, by hand: nothing cascades from
   * a subject. Chunked under D1's 100 bound parameters, so a bulk delete or
   * a purge of any size is as many statements as it needs.
   */
  public async deleteForSubjects(
    type: string,
    subjectIds: readonly number[],
  ): Promise<void> {
    this.subject(type);
    for (const batch of this.bounds.chunk([...new Set(subjectIds)])) {
      await this.comments.deleteMany({
        subjectType: { eq: type },
        subjectId: { inArray: batch },
      });
    }
  }

  protected subject(type: string): CommentSubject {
    const subject = this.subjects.get(type);
    if (!subject) {
      throw new AlephaError(`Comment subject '${type}' is not registered`);
    }
    return subject;
  }
}

/**
 * What a package registers to give its rows a thread.
 */
export interface CommentSubject {
  /**
   * The value of `comments.subjectType`: `quest`, `error`, ...
   */
  type: string;
  /**
   * The subject of this project by its global id, or a thrown 404. The
   * cross-project guard: never answer a row of another project.
   */
  load(projectId: number, subjectId: number): Promise<unknown>;
}

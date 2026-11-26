import {
  CommentService,
  MentionNotifier,
  type MentionSubject,
} from "@lore/core/api";
import type { Comment } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { NotFoundError } from "alepha/server";

import { personas } from "../entities/personas.ts";
import { useCases } from "../entities/useCases.ts";
import type { CommentSubjectKind } from "../schemas/commentSubjectKindSchema.ts";
import type { RequirementsCommentResource } from "../schemas/requirementsCommentResourceSchema.ts";

/**
 * The discussion of a persona or a use case (#E153), on core's `comments`
 * since #E185: the two are subjects registered here, `persona` and
 * `usecase`, the values the old `requirements_comments.subjectKind` held. A
 * mention in a body notifies the way a quest comment's does, through core's
 * `MentionNotifier`.
 *
 * What a caller reads has not changed shape: `agentClient` and `byAgent`
 * are derived from the row's `source`, the one machine mark of core's table
 * (`byAgent` is `kind: "mcp"`, `agentClient` is `client`).
 */
export class RequirementsCommentService {
  protected readonly comments = $inject(CommentService);
  protected readonly mentions = $inject(MentionNotifier);
  protected readonly personas = $repository(personas);
  protected readonly useCases = $repository(useCases);

  constructor() {
    // Each `load` is the cross-project guard `CommentService.add` runs: the
    // row of that project by its id, or a 404. The permission stays with
    // the controller.
    this.comments.registerSubject({
      type: "persona" satisfies CommentSubjectKind,
      load: async (projectId, id) => {
        const row = await this.personas.findOne({
          where: { id: { eq: id }, projectId: { eq: projectId } },
        });
        if (!row) throw new NotFoundError("Persona not found");
        return row;
      },
    });
    this.comments.registerSubject({
      type: "usecase" satisfies CommentSubjectKind,
      load: async (projectId, id) => {
        const row = await this.useCases.findOne({
          where: { id: { eq: id }, projectId: { eq: projectId } },
        });
        if (!row) throw new NotFoundError("Use case not found");
        return row;
      },
    });
  }

  public async list(
    subjectKind: CommentSubjectKind,
    subjectId: number,
  ): Promise<RequirementsCommentResource[]> {
    const rows = await this.comments.list(subjectKind, subjectId);
    return rows.map((row) => this.toResource(subjectKind, row));
  }

  /**
   * Write the comment, then notify whoever it names. The notifier never
   * throws: a comment that saved never fails on a message.
   */
  public async add(options: {
    projectId: number;
    subjectKind: CommentSubjectKind;
    subjectId: number;
    body: string;
    user: UserAccountToken;
    subject: MentionSubject;
    agent?: { client?: string };
  }): Promise<RequirementsCommentResource> {
    const comment = await this.comments.add({
      type: options.subjectKind,
      projectId: options.projectId,
      subjectId: options.subjectId,
      authorId: options.user.id,
      body: options.body,
      ...(options.agent
        ? {
            source: {
              kind: "mcp" as const,
              ...(options.agent.client ? { client: options.agent.client } : {}),
            },
          }
        : {}),
    });
    await this.mentions.notify({
      subject: options.subject,
      authorId: options.user.id,
      body: options.body,
      agent: options.agent,
    });
    return this.toResource(options.subjectKind, comment);
  }

  /**
   * Remove a subject's thread, when the subject is deleted: nothing
   * cascades from a persona or a use case.
   */
  public async deleteOf(
    subjectKind: CommentSubjectKind,
    subjectId: number,
  ): Promise<void> {
    await this.comments.deleteForSubjects(subjectKind, [subjectId]);
  }

  /**
   * Core's row as this package has always answered it.
   */
  protected toResource(
    subjectKind: CommentSubjectKind,
    row: Comment,
  ): RequirementsCommentResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      projectId: row.projectId,
      subjectKind,
      subjectId: row.subjectId,
      ...(row.authorId ? { authorId: row.authorId } : {}),
      body: row.body,
      ...(row.source
        ? {
            byAgent: true,
            ...(row.source.client ? { agentClient: row.source.client } : {}),
          }
        : {}),
    };
  }
}

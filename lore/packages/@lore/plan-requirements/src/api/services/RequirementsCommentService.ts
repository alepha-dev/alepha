import { MentionNotifier, type MentionSubject } from "@lore/plan/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import {
  type RequirementsComment,
  requirementsComments,
} from "../entities/requirementsComments.ts";
import type { CommentSubjectKind } from "../schemas/commentSubjectKindSchema.ts";

/**
 * The discussion of a persona or a use case (#E153), on the one
 * `requirements_comments` table both share. A mention in a body notifies
 * the way a quest comment's does, through Plan's `MentionNotifier`.
 */
export class RequirementsCommentService {
  protected readonly comments = $repository(requirementsComments);
  protected readonly mentions = $inject(MentionNotifier);

  public async list(
    subjectKind: CommentSubjectKind,
    subjectId: number,
  ): Promise<RequirementsComment[]> {
    return await this.comments.findMany({
      where: {
        subjectKind: { eq: subjectKind },
        subjectId: { eq: subjectId },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
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
  }): Promise<RequirementsComment> {
    const comment = await this.comments.create({
      projectId: options.projectId,
      subjectKind: options.subjectKind,
      subjectId: options.subjectId,
      authorId: options.user.id,
      body: options.body,
      ...(options.agent
        ? { byAgent: true, agentClient: options.agent.client }
        : {}),
    });
    await this.mentions.notify({
      subject: options.subject,
      authorId: options.user.id,
      body: options.body,
      agent: options.agent,
    });
    return comment;
  }

  /**
   * Remove a subject's thread, when the subject is deleted.
   */
  public async deleteOf(
    subjectKind: CommentSubjectKind,
    subjectId: number,
  ): Promise<void> {
    await this.comments.deleteMany({
      subjectKind: { eq: subjectKind },
      subjectId: { eq: subjectId },
    });
  }
}

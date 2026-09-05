import { $inject } from "alepha";
import { FileAccessProvider, type FileEntity } from "alepha/api/files";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import { feedback } from "../entities/feedback.ts";
import { folioAttachments } from "../entities/folioAttachments.ts";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { attachmentLookupSchema } from "../schemas/attachmentLookupSchema.ts";
import { FeedbackRateLimiter } from "../services/FeedbackRateLimiter.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * Per-bucket file access policy for Lore.
 *
 * Files are tenant-scoped through the entities that reference them
 * (projects.icon, feedback.attachments[], quests.attachments[]). We
 * locate the owning entity by id, then delegate to the same project
 * gate used by HTTP controllers. The default framework policy is
 * creator-only — this widens it for the well-known buckets.
 */
export class LoreFileAccessProvider extends FileAccessProvider {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly projects = $repository(projects);
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);
  protected readonly folioAttachments = $repository(folioAttachments);

  /**
   * Quest attachments bucket inherits the property name when no `name:` is
   * passed to `$storage(...)` — see `QuestController.attachments`.
   */
  protected static readonly QUEST_ATTACHMENT_BUCKET = "attachments";
  // Bucket value stays "campaign-icons" — see the note on `iconBucket`
  // in `ProjectController.ts`.
  protected static readonly PROJECT_ICON_BUCKET = "campaign-icons";
  protected static readonly AVATAR_BUCKET = "avatars";
  // Bucket value stays "archive-blobs" — see the note on
  // `FOLIO_ATTACHMENT_BUCKET` in `FolioAttachmentService.ts`.
  protected static readonly FOLIO_ATTACHMENT_BUCKET = "archive-blobs";

  async assertReadable(
    file: FileEntity,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenError("File access requires authentication");
    }

    // Privileged identities pass through (admin tooling).
    if (user.ownership === false) {
      return;
    }

    // Uploader is always allowed.
    if (file.creator && file.creator === user.id) {
      return;
    }

    // Avatars are profile pictures rendered across the UI — any
    // authenticated user can fetch them.
    if (file.bucket === LoreFileAccessProvider.AVATAR_BUCKET) {
      return;
    }

    // Project icons: anyone who can see the project can render its icon.
    if (file.bucket === LoreFileAccessProvider.PROJECT_ICON_BUCKET) {
      const project = await this.projects.findOne({
        where: { icon: { eq: file.id } },
      });
      if (project) {
        await this.security.assertMember(project.id, user);
        return;
      }
      // Orphan icon (uploaded but never assigned) stays creator-only.
      throw new ForbiddenError("File access denied");
    }

    // Feedback attachments: project owner triages, including reading
    // attachments from reporters.
    if (file.bucket === FeedbackRateLimiter.ATTACHMENT_BUCKET) {
      const feedback = await this.findFeedbackByAttachment(file.id);
      if (feedback) {
        await this.security.assertOwner(feedback.projectId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Folio attachments: any project member can read the bytes (Drive-
    // style sharing scope per folio #4 Q2). The Lore overlay row holds
    // the project id.
    if (file.bucket === LoreFileAccessProvider.FOLIO_ATTACHMENT_BUCKET) {
      const attachment = await this.folioAttachments.findOne({
        where: { fileId: { eq: file.id } },
      });
      if (attachment) {
        await this.security.assertMember(attachment.projectId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Quest attachments: any project member can view.
    if (file.bucket === LoreFileAccessProvider.QUEST_ATTACHMENT_BUCKET) {
      const quest = await this.findQuestByAttachment(file.id);
      if (quest) {
        await this.security.assertMember(quest.projectId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Unknown bucket: fall back to creator-only (already failed above).
    throw new ForbiddenError("File access denied");
  }

  /**
   * Avatars and project icons are served anonymously through the
   * `/public/files/:id` route (edge-cacheable). They're low-sensitivity,
   * rendered in unauthenticated contexts, and addressed by opaque uuid —
   * so they opt out of the default deny-all. Everything else stays private
   * (base `assertPublic` throws NotFoundError).
   */
  async assertPublic(file: FileEntity): Promise<void> {
    if (
      file.bucket === LoreFileAccessProvider.AVATAR_BUCKET ||
      file.bucket === LoreFileAccessProvider.PROJECT_ICON_BUCKET
    ) {
      return;
    }
    return super.assertPublic(file);
  }

  /**
   * Find the feedback row that lists `fileId` in its `attachments` JSON
   * array. Uses a LIKE against the JSON text — feedback rows are small and
   * the bucket constraint at the call site already narrows the search.
   */
  protected async findFeedbackByAttachment(fileId: string) {
    const needle = `%"${fileId}"%`;
    const rows = await this.database.run(
      sql`SELECT id, project_id as "projectId" FROM ${this.feedback.table} WHERE attachments LIKE ${needle} LIMIT 1`,
      attachmentLookupSchema,
    );
    return rows[0];
  }

  protected async findQuestByAttachment(fileId: string) {
    const needle = `%"${fileId}"%`;
    const rows = await this.database.run(
      sql`SELECT id, project_id as "projectId" FROM ${this.quests.table} WHERE attachments LIKE ${needle} LIMIT 1`,
      attachmentLookupSchema,
    );
    return rows[0];
  }
}

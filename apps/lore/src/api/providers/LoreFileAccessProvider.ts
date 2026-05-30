import { $inject, t } from "alepha";
import { FileAccessProvider, type FileEntity } from "alepha/api/files";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";
import { archiveBlobs } from "../entities/archiveBlobs.ts";
import { campaigns } from "../entities/campaigns.ts";
import { petitions } from "../entities/petitions.ts";
import { quests } from "../entities/quests.ts";
import { PetitionRateLimiter } from "../services/PetitionRateLimiter.ts";
import { AppSecurityProvider } from "./AppSecurityProvider.ts";

const attachmentLookupSchema = t.object({
  id: t.integer(),
  campaignId: t.integer(),
});

/**
 * Per-bucket file access policy for Lore.
 *
 * Files are tenant-scoped through the entities that reference them
 * (campaigns.icon, petitions.attachments[], quests.attachments[]). We
 * locate the owning entity by id, then delegate to the same campaign
 * gate used by HTTP controllers. The default framework policy is
 * creator-only — this widens it for the well-known buckets.
 */
export class LoreFileAccessProvider extends FileAccessProvider {
  protected readonly security = $inject(AppSecurityProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly campaigns = $repository(campaigns);
  protected readonly petitions = $repository(petitions);
  protected readonly quests = $repository(quests);
  protected readonly archiveBlobs = $repository(archiveBlobs);

  /**
   * Quest attachments bucket inherits the property name when no `name:` is
   * passed to `$bucket(...)` — see `QuestController.attachments`.
   */
  protected static readonly QUEST_ATTACHMENT_BUCKET = "attachments";
  protected static readonly CAMPAIGN_ICON_BUCKET = "campaign-icons";
  protected static readonly AVATAR_BUCKET = "avatars";
  protected static readonly ARCHIVE_BLOB_BUCKET = "archive-blobs";

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

    // Campaign icons: anyone who can see the campaign can render its icon.
    if (file.bucket === LoreFileAccessProvider.CAMPAIGN_ICON_BUCKET) {
      const campaign = await this.campaigns.findOne({
        where: { icon: { eq: file.id } },
      });
      if (campaign) {
        await this.security.assertMember(campaign.id, user);
        return;
      }
      // Orphan icon (uploaded but never assigned) stays creator-only.
      throw new ForbiddenError("File access denied");
    }

    // Petition attachments: campaign owner triages, including reading
    // attachments from reporters.
    if (file.bucket === PetitionRateLimiter.ATTACHMENT_BUCKET) {
      const petition = await this.findPetitionByAttachment(file.id);
      if (petition) {
        await this.security.assertOwner(petition.campaignId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Archive blobs: any campaign member can read the bytes (Drive-
    // style sharing scope per folio #4 Q2). The Lore overlay row holds
    // the campaign id.
    if (file.bucket === LoreFileAccessProvider.ARCHIVE_BLOB_BUCKET) {
      const blob = await this.archiveBlobs.findOne({
        where: { fileId: { eq: file.id } },
      });
      if (blob) {
        await this.security.assertMember(blob.campaignId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Quest attachments: any campaign member can view.
    if (file.bucket === LoreFileAccessProvider.QUEST_ATTACHMENT_BUCKET) {
      const quest = await this.findQuestByAttachment(file.id);
      if (quest) {
        await this.security.assertMember(quest.campaignId, user);
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Unknown bucket: fall back to creator-only (already failed above).
    throw new ForbiddenError("File access denied");
  }

  /**
   * Avatars and campaign icons are served anonymously through the
   * `/public/files/:id` route (edge-cacheable). They're low-sensitivity,
   * rendered in unauthenticated contexts, and addressed by opaque uuid —
   * so they opt out of the default deny-all. Everything else stays private
   * (base `assertPublic` throws NotFoundError).
   */
  async assertPublic(file: FileEntity): Promise<void> {
    if (
      file.bucket === LoreFileAccessProvider.AVATAR_BUCKET ||
      file.bucket === LoreFileAccessProvider.CAMPAIGN_ICON_BUCKET
    ) {
      return;
    }
    return super.assertPublic(file);
  }

  /**
   * Find the petition that lists `fileId` in its `attachments` JSON array.
   * Uses a LIKE against the JSON text — petition rows are small and the
   * bucket constraint at the call site already narrows the search.
   */
  protected async findPetitionByAttachment(fileId: string) {
    const needle = `%"${fileId}"%`;
    const rows = await this.database.run(
      sql`SELECT id, campaign_id as "campaignId" FROM ${this.petitions.table} WHERE attachments LIKE ${needle} LIMIT 1`,
      attachmentLookupSchema,
    );
    return rows[0];
  }

  protected async findQuestByAttachment(fileId: string) {
    const needle = `%"${fileId}"%`;
    const rows = await this.database.run(
      sql`SELECT id, campaign_id as "campaignId" FROM ${this.quests.table} WHERE attachments LIKE ${needle} LIMIT 1`,
      attachmentLookupSchema,
    );
    return rows[0];
  }
}

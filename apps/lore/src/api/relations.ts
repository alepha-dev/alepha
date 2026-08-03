import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";
import { archiveBlobs } from "./entities/archiveBlobs.ts";
import { archiveDirectories } from "./entities/archiveDirectories.ts";
import { blightIgnoreRules } from "./entities/blightIgnoreRules.ts";
import { campaigns } from "./entities/campaigns.ts";
import { chapters } from "./entities/chapters.ts";
import { folioLinks } from "./entities/folioLinks.ts";
import { folioRevisions } from "./entities/folioRevisions.ts";
import { folios } from "./entities/folios.ts";
import { members } from "./entities/members.ts";
import { outpostApps } from "./entities/outpostApps.ts";
import { outpostEvents } from "./entities/outpostEvents.ts";
import { outposts } from "./entities/outposts.ts";
import { petitions } from "./entities/petitions.ts";
import { quests } from "./entities/quests.ts";
import { sigils } from "./entities/sigils.ts";

/**
 * Lore's entity graph, as far as foreign keys reach.
 *
 * Two columns look like references and are not, so nothing here declares
 * them:
 *
 * - `petitions.attachments` and `quests.attachments` are `uuid[]`. A JSON
 *   array is not a foreign key and there is no relation to hang on it, so
 *   attachment lookups stay explicit.
 * - `folioLinks.toId` is polymorphic — a folio uuid, a stringified quest id,
 *   or a blob id, told apart by `targetType`. Only the `fromId` side is a real
 *   reference, so only that side appears below.
 *
 * Everything else joins here rather than in a controller.
 */
export const schema = {
  users,
  campaigns,
  members,
  chapters,
  quests,
  petitions,
  folios,
  folioLinks,
  folioRevisions,
  archiveDirectories,
  archiveBlobs,
  outposts,
  outpostApps,
  outpostEvents,
  sigils,
  blightIgnoreRules,
};

export const relations = $relations(schema, (r) => ({
  users: {
    memberships: r.many.members({
      from: r.users.id,
      to: r.members.userId,
    }),
    /**
     * A user's campaigns, through the membership row.
     *
     * Safe as a plain many-to-many because `members` carries a unique
     * index on `(userId, campaignId)`: one membership per user per campaign,
     * so a campaign cannot come back twice. Drop that index and this relation
     * starts duplicating rows — which is why `campaign-relations.spec.ts`
     * pins it.
     */
    campaigns: r.many.campaigns({
      from: r.users.id.through(r.members.userId),
      to: r.campaigns.id.through(r.members.campaignId),
    }),
  },

  campaigns: {
    memberships: r.many.members({
      from: r.campaigns.id,
      to: r.members.campaignId,
    }),
    /** The other side of the same junction, subject to the same index. */
    members: r.many.users({
      from: r.campaigns.id.through(r.members.campaignId),
      to: r.users.id.through(r.members.userId),
    }),
    quests: r.many.quests({ from: r.campaigns.id, to: r.quests.campaignId }),
    chapters: r.many.chapters({
      from: r.campaigns.id,
      to: r.chapters.campaignId,
    }),
    petitions: r.many.petitions({
      from: r.campaigns.id,
      to: r.petitions.campaignId,
    }),
    folios: r.many.folios({ from: r.campaigns.id, to: r.folios.campaignId }),
    directories: r.many.archiveDirectories({
      from: r.campaigns.id,
      to: r.archiveDirectories.campaignId,
    }),
    blobs: r.many.archiveBlobs({
      from: r.campaigns.id,
      to: r.archiveBlobs.campaignId,
    }),
    sigils: r.many.sigils({ from: r.campaigns.id, to: r.sigils.campaignId }),
    blightRules: r.many.blightIgnoreRules({
      from: r.campaigns.id,
      to: r.blightIgnoreRules.campaignId,
    }),
  },

  members: {
    user: r.one.users({ from: r.members.userId, to: r.users.id }),
    campaign: r.one.campaigns({
      from: r.members.campaignId,
      to: r.campaigns.id,
    }),
  },

  chapters: {
    campaign: r.one.campaigns({
      from: r.chapters.campaignId,
      to: r.campaigns.id,
    }),
    quests: r.many.quests({ from: r.chapters.id, to: r.quests.chapterId }),
  },

  quests: {
    campaign: r.one.campaigns({
      from: r.quests.campaignId,
      to: r.campaigns.id,
    }),
    chapter: r.one.chapters({ from: r.quests.chapterId, to: r.chapters.id }),
    petition: r.one.petitions({
      from: r.quests.petitionId,
      to: r.petitions.id,
    }),
    author: r.one.users({ from: r.quests.createdBy, to: r.users.id }),
    acceptedByUser: r.one.users({
      from: r.quests.acceptedBy,
      to: r.users.id,
    }),
    completedByUser: r.one.users({
      from: r.quests.completedBy,
      to: r.users.id,
    }),
    shelvedByUser: r.one.users({ from: r.quests.shelvedBy, to: r.users.id }),
    /** The self relation: a quest gated on another finishing first. */
    blockedBy: r.one.quests({ from: r.quests.dependsOn, to: r.quests.id }),
    blocks: r.many.quests({ from: r.quests.id, to: r.quests.dependsOn }),
  },

  petitions: {
    campaign: r.one.campaigns({
      from: r.petitions.campaignId,
      to: r.campaigns.id,
    }),
    reporter: r.one.users({
      from: r.petitions.reporterUserId,
      to: r.users.id,
    }),
    /** Quests raised from a petition, oldest first at the call site. */
    linkedQuests: r.many.quests({
      from: r.petitions.id,
      to: r.quests.petitionId,
    }),
  },

  folios: {
    campaign: r.one.campaigns({
      from: r.folios.campaignId,
      to: r.campaigns.id,
    }),
    directory: r.one.archiveDirectories({
      from: r.folios.directoryId,
      to: r.archiveDirectories.id,
    }),
    revisions: r.many.folioRevisions({
      from: r.folios.id,
      to: r.folioRevisions.folioId,
    }),
    /**
     * Only the outbound side is a relation. Inbound links are found by
     * `toId`, which is a polymorphic string rather than a reference.
     */
    outboundLinks: r.many.folioLinks({
      from: r.folios.id,
      to: r.folioLinks.fromId,
    }),
  },

  folioLinks: {
    from: r.one.folios({ from: r.folioLinks.fromId, to: r.folios.id }),
  },

  folioRevisions: {
    folio: r.one.folios({ from: r.folioRevisions.folioId, to: r.folios.id }),
    author: r.one.users({ from: r.folioRevisions.byUserId, to: r.users.id }),
  },

  archiveDirectories: {
    campaign: r.one.campaigns({
      from: r.archiveDirectories.campaignId,
      to: r.campaigns.id,
    }),
    parent: r.one.archiveDirectories({
      from: r.archiveDirectories.parentId,
      to: r.archiveDirectories.id,
    }),
    children: r.many.archiveDirectories({
      from: r.archiveDirectories.id,
      to: r.archiveDirectories.parentId,
    }),
    folios: r.many.folios({
      from: r.archiveDirectories.id,
      to: r.folios.directoryId,
    }),
    blobs: r.many.archiveBlobs({
      from: r.archiveDirectories.id,
      to: r.archiveBlobs.directoryId,
    }),
  },

  archiveBlobs: {
    campaign: r.one.campaigns({
      from: r.archiveBlobs.campaignId,
      to: r.campaigns.id,
    }),
    directory: r.one.archiveDirectories({
      from: r.archiveBlobs.directoryId,
      to: r.archiveDirectories.id,
    }),
  },

  sigils: {
    campaign: r.one.campaigns({
      from: r.sigils.campaignId,
      to: r.campaigns.id,
    }),
    author: r.one.users({ from: r.sigils.createdBy, to: r.users.id }),
  },

  blightIgnoreRules: {
    campaign: r.one.campaigns({
      from: r.blightIgnoreRules.campaignId,
      to: r.campaigns.id,
    }),
    author: r.one.users({
      from: r.blightIgnoreRules.createdBy,
      to: r.users.id,
    }),
  },
}));

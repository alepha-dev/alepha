import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";
import { blightIgnoreRules } from "./entities/blightIgnoreRules.ts";
import { feedback } from "./entities/feedback.ts";
import { folioBlobs } from "./entities/folioBlobs.ts";
import { folioDirectories } from "./entities/folioDirectories.ts";
import { folioLinks } from "./entities/folioLinks.ts";
import { folioRevisions } from "./entities/folioRevisions.ts";
import { folios } from "./entities/folios.ts";
import { members } from "./entities/members.ts";
import { milestones } from "./entities/milestones.ts";
import { projects } from "./entities/projects.ts";
import { quests } from "./entities/quests.ts";
import { sigils } from "./entities/sigils.ts";

/**
 * Lore's entity graph, as far as foreign keys reach.
 *
 * Two columns look like references and are not, so nothing here declares
 * them:
 *
 * - `feedback.attachments` and `quests.attachments` are `uuid[]`. A JSON
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
  projects,
  members,
  milestones,
  quests,
  feedback,
  folios,
  folioLinks,
  folioRevisions,
  folioDirectories,
  folioBlobs,
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
     * A user's projects, through the membership row.
     *
     * Safe as a plain many-to-many because `members` carries a unique
     * index on `(userId, projectId)`: one membership per user per project,
     * so a project cannot come back twice. Drop that index and this relation
     * starts duplicating rows — which is why `project-relations.spec.ts`
     * pins it.
     */
    projects: r.many.projects({
      from: r.users.id.through(r.members.userId),
      to: r.projects.id.through(r.members.projectId),
    }),
  },

  projects: {
    /**
     * The account that created the project. `projects.createdBy` carries no
     * foreign key — same as `quests.createdBy` and `sigils.createdBy` below,
     * which declare their `author` here for exactly that reason.
     */
    owner: r.one.users({ from: r.projects.createdBy, to: r.users.id }),
    memberships: r.many.members({
      from: r.projects.id,
      to: r.members.projectId,
    }),
    /** The other side of the same junction, subject to the same index. */
    members: r.many.users({
      from: r.projects.id.through(r.members.projectId),
      to: r.users.id.through(r.members.userId),
    }),
    quests: r.many.quests({ from: r.projects.id, to: r.quests.projectId }),
    milestones: r.many.milestones({
      from: r.projects.id,
      to: r.milestones.projectId,
    }),
    feedback: r.many.feedback({
      from: r.projects.id,
      to: r.feedback.projectId,
    }),
    folios: r.many.folios({ from: r.projects.id, to: r.folios.projectId }),
    directories: r.many.folioDirectories({
      from: r.projects.id,
      to: r.folioDirectories.projectId,
    }),
    blobs: r.many.folioBlobs({
      from: r.projects.id,
      to: r.folioBlobs.projectId,
    }),
    sigils: r.many.sigils({ from: r.projects.id, to: r.sigils.projectId }),
    blightRules: r.many.blightIgnoreRules({
      from: r.projects.id,
      to: r.blightIgnoreRules.projectId,
    }),
  },

  members: {
    user: r.one.users({ from: r.members.userId, to: r.users.id }),
    project: r.one.projects({
      from: r.members.projectId,
      to: r.projects.id,
    }),
  },

  milestones: {
    project: r.one.projects({
      from: r.milestones.projectId,
      to: r.projects.id,
    }),
    quests: r.many.quests({ from: r.milestones.id, to: r.quests.milestoneId }),
  },

  quests: {
    project: r.one.projects({
      from: r.quests.projectId,
      to: r.projects.id,
    }),
    milestone: r.one.milestones({
      from: r.quests.milestoneId,
      to: r.milestones.id,
    }),
    feedback: r.one.feedback({
      from: r.quests.feedbackId,
      to: r.feedback.id,
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

  feedback: {
    project: r.one.projects({
      from: r.feedback.projectId,
      to: r.projects.id,
    }),
    reporter: r.one.users({
      from: r.feedback.reporterUserId,
      to: r.users.id,
    }),
    /** Quests raised from this feedback item, oldest first at the call site. */
    linkedQuests: r.many.quests({
      from: r.feedback.id,
      to: r.quests.feedbackId,
    }),
  },

  folios: {
    project: r.one.projects({
      from: r.folios.projectId,
      to: r.projects.id,
    }),
    directory: r.one.folioDirectories({
      from: r.folios.directoryId,
      to: r.folioDirectories.id,
    }),
    revisions: r.many.folioRevisions({
      from: r.folios.id,
      to: r.folioRevisions.folioId,
    }),
    blobs: r.many.folioBlobs({
      from: r.folios.id,
      to: r.folioBlobs.folioId,
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

  folioDirectories: {
    project: r.one.projects({
      from: r.folioDirectories.projectId,
      to: r.projects.id,
    }),
    parent: r.one.folioDirectories({
      from: r.folioDirectories.parentId,
      to: r.folioDirectories.id,
    }),
    children: r.many.folioDirectories({
      from: r.folioDirectories.id,
      to: r.folioDirectories.parentId,
    }),
    folios: r.many.folios({
      from: r.folioDirectories.id,
      to: r.folios.directoryId,
    }),
  },

  folioBlobs: {
    project: r.one.projects({
      from: r.folioBlobs.projectId,
      to: r.projects.id,
    }),
    folio: r.one.folios({
      from: r.folioBlobs.folioId,
      to: r.folios.id,
    }),
  },

  sigils: {
    project: r.one.projects({
      from: r.sigils.projectId,
      to: r.projects.id,
    }),
    author: r.one.users({ from: r.sigils.createdBy, to: r.users.id }),
  },

  blightIgnoreRules: {
    project: r.one.projects({
      from: r.blightIgnoreRules.projectId,
      to: r.projects.id,
    }),
    author: r.one.users({
      from: r.blightIgnoreRules.createdBy,
      to: r.users.id,
    }),
  },
}));

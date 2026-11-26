import { projects } from "@lore/core/schemas";
import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

/**
 * Work's entity graph: quests, their comments, epics, releases and feedback,
 * and the core tables (users, projects) they point at. See `coreRelations`
 * for why the graph is one value per module.
 *
 * Two columns look like references and are not, so nothing here declares
 * them: `feedback.attachments` and `quests.attachments` are `uuid[]`, and a
 * JSON array is not a foreign key, so attachment lookups stay explicit.
 */
const schema = {
  users,
  projects,
  releases,
  epics,
  quests,
  feedback,
};

export const workRelations = $relations(schema, (r) => ({
  releases: {
    project: r.one.projects({
      from: r.releases.projectId,
      to: r.projects.id,
    }),
    quests: r.many.quests({ from: r.releases.id, to: r.quests.releaseId }),
  },

  epics: {
    project: r.one.projects({ from: r.epics.projectId, to: r.projects.id }),
    quests: r.many.quests({ from: r.epics.id, to: r.quests.epicId }),
  },

  quests: {
    project: r.one.projects({
      from: r.quests.projectId,
      to: r.projects.id,
    }),
    release: r.one.releases({
      from: r.quests.releaseId,
      to: r.releases.id,
    }),
    epic: r.one.epics({ from: r.quests.epicId, to: r.epics.id }),
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
    /**
     * The self relation: a quest gated on another finishing first.
     */
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
    /**
     * The member who trusted an untrusted item (#Q4216).
     */
    truster: r.one.users({
      from: r.feedback.trustedBy,
      to: r.users.id,
    }),
    /**
     * Quests raised from this feedback item, oldest first at the call site.
     */
    linkedQuests: r.many.quests({
      from: r.feedback.id,
      to: r.quests.feedbackId,
    }),
  },
}));

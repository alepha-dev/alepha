import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { projects } from "../entities/projects.ts";
import { questComments } from "../entities/questComments.ts";
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
  questComments,
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
    comments: r.many.questComments({
      from: r.quests.id,
      to: r.questComments.questId,
    }),
  },

  /**
   * A comment carries no `projectId` of its own: the quest it hangs off is
   * what scopes it. Declared here so that scoping can be a join rather than
   * a filter applied to every comment in the instance.
   */
  questComments: {
    quest: r.one.quests({ from: r.questComments.questId, to: r.quests.id }),
    author: r.one.users({ from: r.questComments.authorId, to: r.users.id }),
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
     * Quests raised from this feedback item, oldest first at the call site.
     */
    linkedQuests: r.many.quests({
      from: r.feedback.id,
      to: r.quests.feedbackId,
    }),
  },
}));

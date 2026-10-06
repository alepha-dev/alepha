import { organizationMembers } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { projects } from "../entities/projects.ts";

/**
 * Core's entity graph: users, projects and their memberships, as far as
 * foreign keys reach.
 *
 * One `$relations` value per module (#E75, #Q2623), each naming only the
 * entities that module may see: a feature module's own tables, and the core
 * tables they point at. `$relations` is a plain value with no registry, so
 * the split costs nothing at runtime. Everything joins in one of these files
 * rather than in a controller.
 */
const schema = { users, projects, organizationMembers };

export const coreRelations = $relations(schema, (r) => ({
  users: {
    memberships: r.many.organizationMembers({
      from: r.users.id,
      to: r.organizationMembers.userId,
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
      from: r.users.id.through(r.organizationMembers.userId),
      to: r.projects.organizationId.through(
        r.organizationMembers.organizationId,
      ),
    }),
  },

  projects: {
    /**
     * The account that created the project. `projects.createdBy` carries no
     * foreign key — same as `quests.createdBy` and `sigils.createdBy` below,
     * which declare their `author` here for exactly that reason.
     */
    owner: r.one.users({ from: r.projects.createdBy, to: r.users.id }),
    memberships: r.many.organizationMembers({
      from: r.projects.organizationId,
      to: r.organizationMembers.organizationId,
    }),
    /**
     * The other side of the same junction, subject to the same index.
     */
    members: r.many.users({
      from: r.projects.organizationId.through(
        r.organizationMembers.organizationId,
      ),
      to: r.users.id.through(r.organizationMembers.userId),
    }),
  },

  organizationMembers: {
    user: r.one.users({
      from: r.organizationMembers.userId,
      to: r.users.id,
    }),
    project: r.one.projects({
      from: r.organizationMembers.organizationId,
      to: r.projects.organizationId,
    }),
  },
}));

import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { estates } from "./estates.ts";
import { projects } from "./projects.ts";

/**
 * The lending: which projects may deploy through which estate.
 *
 * An estate is owned by a user (`estates.ownerUserId`) and USED by projects,
 * and this row is the grant. It is deliberately a bare join: no role, no
 * per-member allowlist, no "owner only" flag. The project is the permission
 * boundary, and whoever can deploy in a project can deploy through whatever
 * the project has been lent (folio #1194).
 *
 * Attaching requires the caller to own the estate AND to own the project:
 * attaching changes what a project can deploy to, which is the project
 * owner's decision, and lending exposes the estate owner's account, which is
 * theirs. Detaching takes either owner: the project owner is giving up a
 * capability, the estate owner is withdrawing a loan, and both are
 * legitimate. Both sides cascade, so a deleted estate or a deleted project
 * takes its grants with it, and neither undeploys anything.
 *
 * Detaching is refused while an app instance in that project points at the
 * estate (`EstateService.assertUnreferenced`, given something to count by
 * `app_instances`, #1767).
 */
export const estateProjects = $entity({
  name: "estate_projects",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    estateId: db.ref(z.uuid(), () => estates.cols.id, {
      onDelete: "cascade",
    }),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Who lent it. Set null rather than cascade: the grant outlives the
     * person who made it, since the estate's own owner is the authority
     * and a project keeps what it was lent until somebody detaches it.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [
    { columns: ["estateId", "projectId"], unique: true },
    // The project's estates page, and the lending check `AppService.setEstate`
    // runs before an instance may point at an estate.
    { columns: ["projectId"] },
  ],
});

export type EstateProject = Infer<typeof estateProjects.schema>;

import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { hosts } from "./hosts.ts";

/**
 * The lending: which projects may deploy through which host.
 *
 * A host belongs to its home project (`hosts.projectId`) and is USED by projects,
 * and this row is the grant. It is deliberately a bare join: no role, no
 * per-member allowlist, no "owner only" flag. The project is the permission
 * boundary, and whoever can deploy in a project can deploy through whatever
 * the project has been lent (folio #1194).
 *
 * Attaching requires the caller to own the host AND to own the project:
 * attaching changes what a project can deploy to, which is the project
 * owner's decision, and lending exposes the host owner's account, which is
 * theirs. Detaching takes either owner: the project owner is giving up a
 * capability, the host owner is withdrawing a loan, and both are
 * legitimate. Both sides cascade, so a deleted host or a deleted project
 * takes its grants with it, and neither undeploys anything.
 *
 * Detaching is refused while an app instance in that project points at the
 * host (`HostService.assertUnreferenced`, given something to count by
 * `app_instances`, #1767).
 */
export const hostProjects = $entity({
  name: "host_projects",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    hostId: db.ref(z.uuid(), () => hosts.cols.id, {
      onDelete: "cascade",
    }),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Who lent it. Set null rather than cascade: the grant outlives the
     * person who made it, since the host's own owner is the authority
     * and a project keeps what it was lent until somebody detaches it.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [
    { columns: ["hostId", "projectId"], unique: true },
    // The project's hosts page, and the lending check `AppService.setHost`
    // runs before an instance may point at a host.
    { columns: ["projectId"] },
  ],
});

export type HostProject = Infer<typeof hostProjects.schema>;

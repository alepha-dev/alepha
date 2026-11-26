import { users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projectErrorEventKindSchema } from "../schemas/projectErrorEventKindSchema.ts";
import { projectErrors } from "./projectErrors.ts";

/**
 * One change of an error's triage state (#E185): who resolved it, trusted
 * it or forwarded it, and what Lore did to it by itself. The error row holds
 * only where it stands now; this is how it got there.
 *
 * - **Triage data of Ship, not discussion.** The error's comments are in
 *   core's `comments`; the thread a page shows is the two reads merged by
 *   time (`ProjectErrorThread`). Keeping events out of the shared table is
 *   what keeps it one shape for every subject.
 * - **No `projectId`.** Every access goes through the error, and the
 *   cascade follows it through its deletion, its project's and the
 *   retention purge. A project merge moves `project_errors` and the events
 *   follow by their key.
 * - **A kind and ids, never text.** An error's `name`, `message` and `stack`
 *   come from an application's runtime: nothing of them is copied here.
 *
 * ⚠️ This makes `project_errors` a CASCADE parent: a migration that rebuilds
 * it wipes every error's history on D1. See `apps/lore/AGENTS.md`,
 * "Migration safety on D1".
 */
export const projectErrorEvents = $entity({
  name: "project_error_events",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    projectErrorId: db.ref(z.integer(), () => projectErrors.cols.id, {
      onDelete: "cascade",
    }),
    kind: projectErrorEventKindSchema.meta({ mode: "text" }),
    /**
     * The member who did it, `null` when Lore did it by itself, and once
     * that member deleted their account.
     *
     * `.optional()` sits INSIDE `db.ref` on purpose: outside it no foreign
     * key is generated at all, silently.
     */
    actorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * The quest of a `forwarded`, a `linked` or a `handed_back`, by its
     * global id. A plain value, never a foreign key: Ship references no
     * table of Plan (#E75).
     */
    questId: z.integer().optional(),
  }),
  indexes: [{ columns: ["projectErrorId", "createdAt"] }],
});

export type ProjectErrorEvent = Infer<typeof projectErrorEvents.schema>;

import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { capabilityKeySchema } from "../schemas/capabilityKeySchema.ts";
import { projects } from "./projects.ts";

/**
 * Which product surfaces a project has turned on, one row per enabled
 * capability.
 *
 * **A row exists only for an enabled capability. Absence is disabled.** Never
 * write a row carrying a `false` state: there is no `enabled` column, and the
 * moment there is one, "no row" and "a row saying no" mean the same thing in
 * two places. Disabling deletes the row.
 *
 * ⚠️ **A table rather than more keys in `projects.features`.** That column
 * cannot grow, and two incidents in this repo say so. Renaming a required key
 * inside it took production down on 2026-08-05: a missing required key does
 * not read as `undefined` and fall back, the whole row fails to decode and
 * every query touching `projects` throws. And adding a key to
 * `defaultProjectFeatures` changes the column DEFAULT, which on D1 rebuilds
 * `projects` and cascade-wipes members, quests, releases, folios and feedback
 * (2026-05-13). A child table is a plain additive `CREATE TABLE` and touches
 * neither. It also turns "which projects use Knowledge" into a query instead
 * of a JSON scan.
 *
 * ⚠️ What lives here and what does not. `options` holds **switches**, the
 * things a capability turns on and off. Configuration stays where it is:
 * `retentionDays` (read by the blight purge cron as
 * `project.retentionDays ?? 30`), `roadmapVisibility`, `kanbanColumns`,
 * `kanbanColumnConfig` and `tagColors` are all columns on `projects` for
 * reasons of their own, and one value does not get two homes.
 */
export const projectCapabilities = $entity({
  name: "project_capabilities",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    key: capabilityKeySchema,
    /**
     * When the capability was turned on. The row is created at that moment
     * and deleted when it is turned off, so this is the row's own creation
     * stamp; `db.createdAt()` gives it the column DEFAULT that fills it, and
     * a write may still pass a value, which is what lets the backfill stamp
     * every row with its project's `createdAt` rather than the migration's
     * clock. The activity feed reads it.
     */
    enabledAt: db.createdAt(),
    /**
     * The switches inside this capability, e.g. `{ board: true }` for `work`
     * or `{ track: true, deploy: false }` for `apps`.
     *
     * **No required keys and no closed shape here on purpose.** The entity
     * schema also decodes rows on READ, so a key this app has not shipped yet
     * must never make an existing row fail to load — that is the 2026-08-05
     * failure mode, one table over. The closed per-capability schemas that
     * refuse an unknown key live on the write path, the same split `title`
     * and `projectTitleSchema` already use.
     *
     * Readers treat an absent option and a `false` one alike, which is what
     * lets the backfill write all six Work options in one `json_object`. The
     * "never a false state" rule above is about capability ROWS, not about
     * the switches inside one.
     *
     * Values are booleans because every option so far is one. Widening this
     * later to a union is safe in the direction that matters: an old row of
     * booleans still decodes against a wider type. Narrowing never is.
     */
    options: db.default(z.record(z.text(), z.boolean()), {}),
  }),
  indexes: [{ columns: ["projectId", "key"], unique: true }],
});

export type ProjectCapability = Infer<typeof projectCapabilities.schema>;

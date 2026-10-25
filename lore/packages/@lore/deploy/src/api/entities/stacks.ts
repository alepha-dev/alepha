import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { estates } from "./estates.ts";

/**
 * A group of apps and services deployed together from one `compose.yml`, the
 * Bay concept (Bay epics #E73 to #E75, folio #F1355 there).
 *
 * ## One project per stack
 *
 * Its apps are app instances of THIS project, and nothing else: a stack is
 * how one project ships, never a way to borrow another project's copies. The
 * check lives in `StackService.attachInstance`.
 *
 * ## The default estate, overridable per environment
 *
 * {@link estateId} is where an environment deploys when it names none of its
 * own, so staging can run on a cheaper machine without every environment
 * repeating the choice. Validated against the LENDING (`estate_projects`),
 * never against `estates` directly, exactly like `app_instances.estateId`.
 *
 * ⚠️ `set null` for the reason `app_instances.estateId` gives: deleting an
 * account cascades to its estates, and that must not be blockable by other
 * people's projects. A stack whose estate went away keeps its revisions and
 * simply has nowhere to deploy until one is chosen again.
 */
export const stacks = $entity({
  name: "stacks",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The stack's name, e.g. `umami`, which is also its name on Bay
     * (`umami/production`). Defaults to the project slug.
     *
     * Same charset and same column/input asymmetry as `app_instances.app`.
     */
    name: z.string().min(1).max(100),
    /**
     * Where an environment deploys when it names no estate of its own.
     */
    estateId: db.ref(z.uuid().optional(), () => estates.cols.id, {
      onDelete: "set null",
    }),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [
    { columns: ["projectId", "name"], unique: true },
    { columns: ["estateId"] },
  ],
});

export type Stack = Infer<typeof stacks.schema>;

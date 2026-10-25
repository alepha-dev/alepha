import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { stackEnvironments } from "./stackEnvironments.ts";

/**
 * One full domain one service of a stack environment answers on.
 *
 * This is how an UNMODIFIED compose file gets routed: the official Umami file
 * carries no route at all, and its environments get `analytics.bob.dev` and
 * `analytics-staging.bob.dev` here. A compose file only ever carries labels
 * relative to the base domain (`@`, `auth`), because production and staging
 * need different full domains.
 *
 * A domain is unique per environment; the estate refuses one claimed by
 * another environment or app on the same machine.
 */
export const stackEnvironmentRoutes = $entity({
  name: "stack_environment_routes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    environmentId: db.ref(z.uuid(), () => stackEnvironments.cols.id, {
      onDelete: "cascade",
    }),
    service: z.string().min(1).max(100),
    domain: z.string().min(1).max(253),
  }),
  indexes: [{ columns: ["environmentId", "domain"], unique: true }],
});

export type StackEnvironmentRoute = Infer<typeof stackEnvironmentRoutes.schema>;

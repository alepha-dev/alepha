import type { Infer } from "alepha";
import { z } from "alepha";

import { appInstances } from "../entities/appInstances.ts";
import { stackEnvironmentRoutes } from "../entities/stackEnvironmentRoutes.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";

/**
 * One stack environment as every surface renders it: the row, its full-domain
 * routes, and the app instances that are members of it. Picked from the
 * owning schemas, so a column added to one of them cannot ride along.
 */
export const stackEnvironmentResourceSchema = stackEnvironments.schema.extend({
  routes: z.array(
    stackEnvironmentRoutes.schema.pick({ service: true, domain: true }),
  ),
  members: z.array(
    appInstances.schema.pick({ id: true, app: true, env: true }),
  ),
});

export type StackEnvironmentResource = Infer<
  typeof stackEnvironmentResourceSchema
>;

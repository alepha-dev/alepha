import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { estates } from "./estates.ts";
import { stacks } from "./stacks.ts";

/**
 * One running copy of a stack: `umami/production`, `umami/staging`. On Bay it
 * is a Compose project with its own network, volumes, variables and routes.
 *
 * {@link estateId} absent means the stack's default estate, which is the
 * common case; set, it moves this environment alone (staging on a cheaper
 * VPS). {@link revision} is the number of the revision last applied here,
 * written by the deploy, so two environments can run two revisions.
 */
export const stackEnvironments = $entity({
  name: "stack_environments",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    stackId: db.ref(z.uuid(), () => stacks.cols.id, { onDelete: "cascade" }),
    /**
     * The environment's name, the same opaque slug as `app_instances.env`:
     * an app instance joins the environment of its own env name.
     */
    env: z.string().min(1).max(100),
    estateId: db.ref(z.uuid().optional(), () => estates.cols.id, {
      onDelete: "set null",
    }),
    /**
     * What the compose file's route labels resolve against: `@` is this
     * domain, `auth` is `auth.<this>`. Absent means the estate's own default
     * (`<stack>[-<env>].<base>` on Bay).
     */
    baseDomain: z.string().max(253).optional(),
    /**
     * The revision number last applied here. Absent before the first deploy.
     */
    revision: z.integer().optional(),
  }),
  indexes: [
    { columns: ["stackId", "env"], unique: true },
    { columns: ["estateId"] },
  ],
});

export type StackEnvironment = Infer<typeof stackEnvironments.schema>;

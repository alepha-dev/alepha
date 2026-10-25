import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { stackEnvironments } from "./stackEnvironments.ts";

/**
 * One variable of one stack environment: what its compose file interpolates
 * (`${DB_PASSWORD}`) and what its services see.
 *
 * Sealed at rest exactly like `app_secrets`, under the same purpose
 * (`lore:app-secrets:v1`), and opened only by a deploy. No response carries
 * a value, for anybody: {@link valuePrefix} is what a list says instead, and
 * it is empty for a value short enough that a prefix would be most of it.
 *
 * Per environment, so production's database password is never staging's.
 * Cascades from the environment: a variable outliving its target is a secret
 * nobody can find to revoke.
 */
export const stackVariables = $entity({
  name: "stack_variables",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    environmentId: db.ref(z.uuid(), () => stackEnvironments.cols.id, {
      onDelete: "cascade",
    }),
    key: z.string().min(1).max(100),
    valueSealed: z.string().min(1).max(20_000),
    valuePrefix: db.default(z.string().max(8), ""),
    /**
     * Whether Lore generated the value (`generate: true`), so the list can say
     * nobody ever typed it.
     */
    generated: db.default(z.boolean(), false),
    keyVersion: db.default(z.integer(), 1),
    updatedBy: z.uuid().optional(),
  }),
  indexes: [{ columns: ["environmentId", "key"], unique: true }],
});

export type StackVariable = Infer<typeof stackVariables.schema>;

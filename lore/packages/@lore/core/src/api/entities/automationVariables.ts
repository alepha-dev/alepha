import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * ⚠️ Kept until #Q3902 drops the table: nothing reads or writes it since
 * #Q3896 deleted the automation engine. Its columns keep their storage
 * shape, so no migration is generated before the drop.
 */
export const automationVariables = $entity({
  name: "automation_variables",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_]+$/),
    version: db.version(),
    value: z.record(z.string(), z.any()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [{ columns: ["projectId", "key"], unique: true }],
});

export type AutomationVariable = Infer<typeof automationVariables.schema>;

import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automationVariableValueSchema } from "../schemas/automationVariableValueSchema.ts";
import { projects } from "./projects.ts";

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
    value: automationVariableValueSchema,
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [{ columns: ["projectId", "key"], unique: true }],
});

export type AutomationVariable = Infer<typeof automationVariables.schema>;

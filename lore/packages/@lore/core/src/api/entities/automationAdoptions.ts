import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automationAdoptionPolicySchema } from "../schemas/automationAdoptionPolicySchema.ts";
import { automations } from "./automations.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

export const automationAdoptions = $entity({
  name: "automation_adoptions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    policy: automationAdoptionPolicySchema,
    automationId: db.ref(z.uuid(), () => automations.cols.id, {
      onDelete: "restrict",
    }),
    authorUserId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "restrict",
    }),
    state: z.enum(["pending", "adopted"]),
    adoptedAt: z.datetime().optional(),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "policy"], unique: true },
    { columns: ["automationId"] },
  ],
});
export type AutomationAdoption = Infer<typeof automationAdoptions.schema>;

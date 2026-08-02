import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const refunds = $entity({
  name: "refunds",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    intentId: z.uuid(),
    amount: z.integer(),
    currency: z.text({ size: "short" }),
    status: z.enum(["pending", "processing", "completed", "failed"]),
    reason: z.text().optional(),
    providerRef: z.text().optional(),
  }),
  indexes: ["intentId", "organizationId", "status"],
});

export type RefundEntity = Infer<typeof refunds.schema>;

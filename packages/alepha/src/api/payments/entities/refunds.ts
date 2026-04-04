import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const refunds = $entity({
  name: "refunds",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    intentId: t.uuid(),
    amount: t.integer(),
    currency: t.text({ size: "short" }),
    status: t.enum(["pending", "processing", "completed", "failed"]),
    reason: t.optional(t.text()),
    providerRef: t.optional(t.text()),
  }),
  indexes: ["intentId", "organizationId", "status"],
});

export type RefundEntity = Static<typeof refunds.schema>;

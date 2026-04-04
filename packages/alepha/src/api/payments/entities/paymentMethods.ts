import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const paymentMethods = $entity({
  name: "payment_methods",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    userId: t.uuid(),
    type: t.text({ size: "short" }),
    brand: t.optional(t.text({ size: "short" })),
    last4: t.optional(t.text({ size: "short" })),
    expMonth: t.optional(t.integer()),
    expYear: t.optional(t.integer()),
    isDefault: t.boolean(),
    providerRef: t.text(),
  }),
  indexes: ["userId", "organizationId"],
});

export type PaymentMethodEntity = Static<typeof paymentMethods.schema>;

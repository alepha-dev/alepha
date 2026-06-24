import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const paymentMethods = $entity({
  name: "payment_methods",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    userId: z.uuid(),
    type: z.text({ size: "short" }),
    brand: z.text({ size: "short" }).optional(),
    last4: z.text({ size: "short" }).optional(),
    expMonth: z.integer().optional(),
    expYear: z.integer().optional(),
    isDefault: z.boolean(),
    providerRef: z.text(),
  }),
  indexes: ["userId", "organizationId"],
});

export type PaymentMethodEntity = Static<typeof paymentMethods.schema>;

import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { organizations } from "./organizations.ts";

export const organizationRanks = $entity({
  name: "organization_ranks",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.ref(z.uuid(), () => organizations.cols.id, {
      onDelete: "cascade",
    }),
    key: z.text({ minLength: 1, maxLength: 64 }),
    name: z.text({ minLength: 1, maxLength: 100 }),
    builtin: db.default(z.boolean(), false),
    permissions: z.array(z.text()),
  }),
  indexes: [
    { columns: ["organizationId", "key"], unique: true },
    { columns: ["organizationId"] },
  ],
});

export type OrganizationRank = Infer<typeof organizationRanks.schema>;

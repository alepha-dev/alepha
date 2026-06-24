import type { Static } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

export const organizations = $entity({
  name: "organizations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    name: z.text(),
    slug: z.text({ minLength: 2, maxLength: 100 }),
    enabled: db.default(z.boolean(), true),
  }),
  indexes: [{ columns: ["slug"], unique: true }],
});

export type OrganizationEntity = Static<typeof organizations.schema>;

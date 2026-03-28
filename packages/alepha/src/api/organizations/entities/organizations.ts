import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

export const organizations = $entity({
  name: "organizations",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    name: t.text(),
    slug: t.text({ minLength: 2, maxLength: 100 }),
    enabled: db.default(t.boolean(), true),
  }),
  indexes: [{ columns: ["slug"], unique: true }],
});

export type OrganizationEntity = Static<typeof organizations.schema>;

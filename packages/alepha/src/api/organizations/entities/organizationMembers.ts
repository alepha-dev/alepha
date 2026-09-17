import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { organizations } from "./organizations.ts";

export const organizationMembers = $entity({
  name: "organization_members",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.ref(z.uuid(), () => organizations.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    rank: z.text({ maxLength: 64 }).optional(),
  }),
  indexes: [{ columns: ["organizationId", "userId"], unique: true }],
});

export type OrganizationMember = Infer<typeof organizationMembers.schema>;

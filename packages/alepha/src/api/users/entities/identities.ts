import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const identities = $entity({
  name: "identities",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(z.uuid(), () => users.cols.id),
    password: z.text().optional(),
    provider: z.text(),
    providerUserId: z.text().optional(),
    providerData: z.json().optional(),
  }),
  indexes: [
    "userId",
    "provider",
    { columns: ["userId", "provider"] },
    { columns: ["provider", "providerUserId"], unique: true },
  ],
});

export type IdentityEntity = Static<typeof identities.schema>;

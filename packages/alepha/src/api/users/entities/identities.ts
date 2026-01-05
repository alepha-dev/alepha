import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const identities = $entity({
  name: "identities",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(t.uuid(), () => users.cols.id),
    password: t.optional(t.text()),
    provider: t.text(),
    providerUserId: t.optional(t.text()),
    providerData: t.optional(t.json()),
  }),
});

export type IdentityEntity = Static<typeof identities.schema>;

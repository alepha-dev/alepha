import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/orm";
import { users } from "./users.ts";

export const identities = $entity({
  name: "identities",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    userId: pg.ref(t.uuid(), () => users.cols.id),
    provider: t.string(),
    providerUserId: t.string(),
    providerData: t.optional(t.json()),
  }),
});

export type IdentityEntity = Static<typeof identities.schema>;

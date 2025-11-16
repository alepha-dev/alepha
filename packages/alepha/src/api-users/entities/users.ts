import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    email: t.string({ format: "email" }),
    roles: t.array(t.string(), { default: ["user"] }),
    name: t.optional(t.string()),
    firstName: t.optional(t.string()),
    lastName: t.optional(t.string()),
    picture: t.optional(t.string()),
    enabled: pg.default(t.boolean(), true),

    emailVerified: pg.default(t.boolean(), false),
  }),
});

export type UserEntity = Static<typeof users.schema>;

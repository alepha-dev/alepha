import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const DEFAULT_USER_REALM_NAME = "default";

export const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    realm: pg.default(t.text(), DEFAULT_USER_REALM_NAME),

    username: t.optional(
      t.shortText({
        minLength: 3,
        maxLength: 50,
        pattern: "^[a-zA-Z0-9._-]+$",
      }),
    ),

    email: t.optional(t.string({ format: "email" })),

    phoneNumber: t.optional(t.e164()),

    roles: pg.default(t.array(t.string()), []),
    firstName: t.optional(t.string()),
    lastName: t.optional(t.string()),
    picture: t.optional(t.string()),
    enabled: pg.default(t.boolean(), true),

    emailVerified: pg.default(t.boolean(), false),
  }),
  indexes: [
    { columns: ["realm", "username"], unique: true },
    { columns: ["realm", "email"], unique: true },
    { columns: ["realm", "phoneNumber"], unique: true },
  ],
});

export type UserEntity = Static<typeof users.schema>;

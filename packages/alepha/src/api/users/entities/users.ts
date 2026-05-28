import { type Static, t } from "alepha";
import { $entity, db, sql } from "alepha/orm";

export const DEFAULT_USER_REALM_NAME = "default";

export const users = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    realm: db.default(t.text(), DEFAULT_USER_REALM_NAME),

    username: t.optional(
      t.shortText({
        minLength: 3,
        maxLength: 30,
        // pattern is handled at the realm settings level
      }),
    ),

    email: t.optional(t.string({ format: "email" })),

    phoneNumber: t.optional(t.e164()),

    roles: db.default(t.array(t.string()), []),
    firstName: t.optional(t.string()),
    lastName: t.optional(t.string()),
    picture: t.optional(t.string()),
    enabled: db.default(t.boolean(), true),

    emailVerified: db.default(t.boolean(), false),

    lastLoginAt: t.optional(t.datetime()),

    organizationId: db.organization(),
  }),
  indexes: [
    {
      expressions: (self) => [self.realm, sql`LOWER(${self.username})`],
      unique: true,
      name: "users_realm_username_lower_idx",
    },
    { columns: ["realm", "email"], unique: true },
    { columns: ["realm", "phoneNumber"], unique: true },
  ],
});

export type UserEntity = Static<typeof users.schema>;

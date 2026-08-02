import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

export const DEFAULT_USER_REALM_NAME = "default";

export const users = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    realm: db.default(z.text(), DEFAULT_USER_REALM_NAME),

    username: z
      .shortText({
        minLength: 3,
        maxLength: 30,
        // pattern is handled at the realm settings level
      })
      .optional(),

    email: z.string().meta({ format: "email" }).optional(),

    phoneNumber: z.e164().optional(),

    roles: db.default(z.array(z.string()), []),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    picture: z.string().optional(),
    enabled: db.default(z.boolean(), true),

    emailVerified: db.default(z.boolean(), false),

    lastLoginAt: z.datetime().optional(),

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

export type UserEntity = Infer<typeof users.schema>;

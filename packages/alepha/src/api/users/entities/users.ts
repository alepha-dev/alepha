import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

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
      // Case-insensitive uniqueness of a username within a realm, written
      // through `ctx.caseInsensitive` rather than a literal `LOWER(...)`.
      //
      // The two are the same constraint - sqlite's `lower()` and its `NOCASE`
      // collation both fold ASCII only - but a bare `LOWER()` here made this
      // index unreadable to drizzle-kit v1's sqlite introspection, which
      // throws on any MULTI-column unique index carrying an expression. Every
      // app with the identity surface has this index, so `push` and the
      // dev-mode `DATABASE_SYNC` built on it could not apply a single schema
      // change to a database that already existed. See the helper's own doc.
      //
      // Renamed off `..._lower_idx` deliberately, and that rename is what
      // makes the fix reach databases that already exist. drizzle-kit's diff
      // keys an index on its NAME: change only the expression and it reports
      // "no changes", so no migration is written, the old `LOWER()` index
      // stays on disk, and push keeps throwing on exactly the databases that
      // have been running longest. Renaming forces the one migration that
      // matters, `DROP INDEX` + `CREATE UNIQUE INDEX` - safe even on D1,
      // where it is dropping a TABLE that silently wipes CASCADE children.
      expressions: (self, ctx) => [
        self.realm,
        ctx.caseInsensitive(self.username),
      ],
      unique: true,
      name: "users_realm_username_ci_idx",
    },
    { columns: ["realm", "email"], unique: true },
    { columns: ["realm", "phoneNumber"], unique: true },
  ],
});

export type UserEntity = Infer<typeof users.schema>;

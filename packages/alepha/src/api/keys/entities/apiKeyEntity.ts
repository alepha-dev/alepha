import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

export const apiKeyEntity = $entity({
  name: "api_keys",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    // Owner
    userId: z.uuid(),

    // Key metadata
    name: z.text({ maxLength: 100 }),
    description: z.text({ maxLength: 500 }).optional(),

    // Token (hashed) - internal, not user input
    tokenHash: z.string().max(256),
    tokenPrefix: z.string().max(10),
    tokenSuffix: z.string().max(8),

    // Roles (snapshot from user at creation)
    roles: db.default(z.array(z.string()), []),

    /**
     * The key's own permission scope: registered `group:name` strings, never
     * patterns. Empty means everything the roles allow, which is what every
     * key created before scopes existed has, so `validate()` turns an empty
     * column into no scope at all rather than a scope admitting nothing.
     */
    permissions: db.default(z.array(z.string()), []),

    // Tracking. All three are APPROXIMATE: a key writes its usage at most once
    // per `apiKeyOptions.usageWriteIntervalMinutes` (5 by default) in each
    // isolate, so they are accurate to that interval and no finer. Do not
    // build billing or an audit on them.

    /**
     * When the key last authenticated a request, to within the usage write
     * interval.
     */
    lastUsedAt: z.datetime().optional(),

    /**
     * The client address of a request the key authenticated, one from within
     * the usage write interval, not necessarily the latest.
     */
    lastUsedIp: z.string().max(45).optional(),

    /**
     * How many usage writes the key has had: one per interval per isolate in
     * which it was used, so a lower bound on its requests, not their count.
     */
    usageCount: db.default(z.integer(), 0),

    // Lifecycle
    expiresAt: z.datetime().optional(),
    revokedAt: z.datetime().optional(),

    /**
     * When the key's secret was last replaced by a rotation. The row, its
     * name and its scope stay; the token, its expiry and its usage history
     * start again.
     */
    rotatedAt: z.datetime().optional(),

    /**
     * When the owner was told this key is about to expire. The notice goes
     * out once per expiry: set when it is sent, part of what the daily job
     * selects on, and cleared by a rotation, which gives the key a new expiry.
     */
    expiryNoticeSentAt: z.datetime().optional(),
  }),
  indexes: [
    // Unique among keys that are not revoked: revoking a key frees its name
    // at once, so a leaked "CI pipeline" can be replaced by a new one under
    // the same name without waiting for the purge. An expired key keeps its
    // name, because rotating it is how it is renewed.
    //
    // Named apart from the full index it replaces: drizzle-kit does not diff
    // the `where` of an index that keeps its name, and generated no migration
    // at all for the change.
    {
      name: "api_keys_user_id_name_live_idx",
      columns: ["userId", "name"],
      unique: true,
      where: sql`revoked_at IS NULL`,
    },
    { columns: ["tokenHash"], unique: true },
  ],
});

export type ApiKeyEntity = Infer<typeof apiKeyEntity.schema>;

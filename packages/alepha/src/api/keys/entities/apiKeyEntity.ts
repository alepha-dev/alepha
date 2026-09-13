import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

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
  }),
  indexes: [
    { columns: ["userId", "name"], unique: true },
    { columns: ["tokenHash"], unique: true },
  ],
});

export type ApiKeyEntity = Infer<typeof apiKeyEntity.schema>;

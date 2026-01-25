import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const apiKeyEntity = $entity({
  name: "api_keys",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    // Owner
    userId: t.uuid(),

    // Key metadata
    name: t.text({ maxLength: 100 }),
    description: t.optional(t.text({ maxLength: 500 })),

    // Token (hashed) - internal, not user input
    tokenHash: t.string({ maxLength: 256 }),
    tokenPrefix: t.string({ maxLength: 10 }),
    tokenSuffix: t.string({ maxLength: 8 }),

    // Roles (snapshot from user at creation)
    roles: db.default(t.array(t.string()), []),

    // Tracking
    lastUsedAt: t.optional(t.datetime()),
    lastUsedIp: t.optional(t.string({ maxLength: 45 })),
    usageCount: db.default(t.integer(), 0),

    // Lifecycle
    expiresAt: t.optional(t.datetime()),
    revokedAt: t.optional(t.datetime()),
  }),
  indexes: [
    { columns: ["userId", "name"], unique: true },
    { columns: ["tokenHash"], unique: true },
  ],
});

export type ApiKeyEntity = Static<typeof apiKeyEntity.schema>;

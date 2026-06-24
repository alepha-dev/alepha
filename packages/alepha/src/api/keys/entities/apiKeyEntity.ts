import { type Static, z } from "alepha";
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

    // Tracking
    lastUsedAt: z.datetime().optional(),
    lastUsedIp: z.string().max(45).optional(),
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

export type ApiKeyEntity = Static<typeof apiKeyEntity.schema>;

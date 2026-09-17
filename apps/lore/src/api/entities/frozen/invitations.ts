import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Frozen legacy invitation rows.
 *
 * Lore now reads and writes `organization_invitations`. This declaration
 * only keeps the historical `invitations` table in the migration snapshot.
 * Nothing may read it, write it, or build new behavior on it.
 */
export const frozenInvitations = $entity({
  name: "invitations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    invitedBy: z.uuid(),
    email: z.string().meta({ format: "email" }),
    resourceType: z.text({ minLength: 1, maxLength: 100 }),
    resourceId: z.text({ minLength: 1, maxLength: 255 }),
    status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
    roles: z.array(z.text()).optional(),
    metadata: z.record(z.text(), z.any()).optional(),
    expiresAt: z.datetime(),
    resolvedAt: z.datetime().optional(),
    resolvedBy: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["email", "status"] },
    { columns: ["resourceType", "resourceId", "email", "status"] },
    { columns: ["invitedBy"] },
    { columns: ["expiresAt"] },
  ],
});

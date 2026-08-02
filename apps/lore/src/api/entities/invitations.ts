import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

export const invitations = $entity({
  name: "invitations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    invitedBy: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    email: z.string().meta({ format: "email" }),
    resourceType: z.text({ minLength: 1, maxLength: 100 }),
    resourceId: z.text({ minLength: 1, maxLength: 255 }),
    status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
    roles: z.array(z.text()).optional(),
    metadata: z.record(z.text(), z.any()).optional(),
    expiresAt: z.datetime(),
    resolvedAt: z.datetime().optional(),
    resolvedBy: db.ref(z.uuid(), () => users.cols.id).optional(),
  }),
  indexes: [
    { columns: ["email", "status"] },
    { columns: ["resourceType", "resourceId", "email", "status"] },
    { columns: ["invitedBy"] },
    { columns: ["expiresAt"] },
  ],
});

export type InvitationEntity = Infer<typeof invitations.schema>;

import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

export const invitations = $entity({
  name: "invitations",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    invitedBy: db.ref(t.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    email: t.string({ format: "email" }),
    resourceType: t.text({ minLength: 1, maxLength: 100 }),
    resourceId: t.text({ minLength: 1, maxLength: 255 }),
    status: t.enum(["pending", "accepted", "declined", "expired", "revoked"]),
    roles: t.optional(t.array(t.text())),
    metadata: t.optional(t.record(t.text(), t.any())),
    expiresAt: t.datetime(),
    resolvedAt: t.optional(t.datetime()),
    resolvedBy: t.optional(db.ref(t.uuid(), () => users.cols.id)),
  }),
  indexes: [
    { columns: ["email", "status"] },
    { columns: ["resourceType", "resourceId", "email", "status"] },
    { columns: ["invitedBy"] },
    { columns: ["expiresAt"] },
  ],
});

export type InvitationEntity = Static<typeof invitations.schema>;

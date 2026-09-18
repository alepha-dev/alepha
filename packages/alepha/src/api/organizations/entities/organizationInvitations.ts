import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { organizationInvitationStatusSchema } from "../schemas/organizationInvitationStatusSchema.ts";
import { organizations } from "./organizations.ts";

export const organizationInvitations = $entity({
  name: "organization_invitations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.ref(z.uuid(), () => organizations.cols.id, {
      onDelete: "cascade",
    }),
    invitedBy: z.uuid(),
    email: z.string().meta({ format: "email" }),
    status: organizationInvitationStatusSchema,
    rank: z.text({ maxLength: 64 }).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    expiresAt: z.datetime(),
    resolvedAt: z.datetime().optional(),
    resolvedBy: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["email", "status"] },
    { columns: ["organizationId", "email", "status"] },
    { columns: ["invitedBy"] },
    { columns: ["expiresAt"] },
  ],
});

export type OrganizationInvitation = Infer<
  typeof organizationInvitations.schema
>;

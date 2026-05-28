import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const invitationQuerySchema = t.extend(pageQuerySchema, {
  email: t.optional(t.text({ description: "Filter by invited email" })),
  resourceType: t.optional(t.text({ description: "Filter by resource type" })),
  resourceId: t.optional(t.text({ description: "Filter by resource ID" })),
  status: t.optional(
    t.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  ),
  invitedBy: t.optional(t.uuid()),
});

export type InvitationQuery = Static<typeof invitationQuerySchema>;

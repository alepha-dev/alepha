import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const invitationQuerySchema = pageQuerySchema.extend({
  email: z.text({ description: "Filter by invited email" }).optional(),
  resourceType: z.text({ description: "Filter by resource type" }).optional(),
  resourceId: z.text({ description: "Filter by resource ID" }).optional(),
  status: z
    .enum(["pending", "accepted", "declined", "expired", "revoked"])
    .optional(),
  invitedBy: z.uuid().optional(),
});

export type InvitationQuery = Infer<typeof invitationQuerySchema>;

import { z } from "alepha";
import { organizationInvitations } from "alepha/api/organizations";

/**
 * A pending invitation as the invitee sees it in their own inbox: the
 * invitation row plus the two names needed to say who invited them where.
 */
export const invitationInboxItemSchema = organizationInvitations.schema.extend({
  resourceId: z.string(),
  projectTitle: z.string(),
  inviterName: z.string().optional(),
});

import { z } from "alepha";

import { invitationResourceSchema } from "./invitationResourceSchema.ts";

/**
 * A pending invitation as the invitee sees it in their own inbox: the
 * invitation row plus the two names needed to say who invited them where.
 */
export const invitationInboxItemSchema = invitationResourceSchema.extend({
  projectTitle: z.string(),
  inviterName: z.string().optional(),
});

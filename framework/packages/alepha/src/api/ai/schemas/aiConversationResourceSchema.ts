import { type Infer, z } from "alepha";

import { aiPendingCallSchema } from "./aiPendingCallSchema.ts";

/**
 * A conversation in the caller's list.
 */
export const aiConversationResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
  title: z.text().optional(),
  pendingCall: aiPendingCallSchema.optional(),
});

export type AiConversationResource = Infer<typeof aiConversationResourceSchema>;

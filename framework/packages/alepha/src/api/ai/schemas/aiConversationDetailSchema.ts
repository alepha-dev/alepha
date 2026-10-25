import { type Infer, z } from "alepha";

import { aiConversationResourceSchema } from "./aiConversationResourceSchema.ts";
import { aiMessageResourceSchema } from "./aiMessageResourceSchema.ts";

/**
 * One conversation with its messages, oldest first.
 */
export const aiConversationDetailSchema = z.object({
  conversation: aiConversationResourceSchema,
  messages: z.array(aiMessageResourceSchema),
});

export type AiConversationDetail = Infer<typeof aiConversationDetailSchema>;

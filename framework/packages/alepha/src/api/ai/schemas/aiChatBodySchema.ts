import { type Infer, z } from "alepha";

import { aiPageContextSchema } from "./aiPageContextSchema.ts";

/**
 * One new turn: the user's message, in a new conversation or an existing
 * one, with the page it was typed on.
 */
export const aiChatBodySchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.text({ size: "rich", minLength: 1 }),
  context: aiPageContextSchema.optional(),
  /**
   * The `$ai` to talk to, by name, when the app declares more than one.
   */
  assistant: z.text({ maxLength: 64 }).optional(),
});

export type AiChatBody = Infer<typeof aiChatBodySchema>;

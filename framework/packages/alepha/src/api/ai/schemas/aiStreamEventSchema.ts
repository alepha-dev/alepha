import { type Infer, z } from "alepha";

/**
 * One event of the chat and resume streams.
 *
 * - `conversation`: first, the id of the conversation the turn belongs to.
 * - `text`: a delta of the assistant's reply.
 * - `tool_call` / `tool_result`: an automatic call starting and finishing.
 * - `confirm` / `client_tool`: the turn paused on this call (`input` is the
 *   stored one, for the confirmation card).
 * - `error`: the turn failed after the stream opened; `name` is the error's.
 * - `end`: the turn is over (`stop`, `length`) or paused (`paused`).
 */
export const aiStreamEventSchema = z.object({
  type: z.enum([
    "conversation",
    "text",
    "tool_call",
    "tool_result",
    "confirm",
    "client_tool",
    "error",
    "end",
  ]),
  conversationId: z.uuid().optional(),
  text: z.text({ size: "rich" }).optional(),
  callId: z.text({ maxLength: 128 }).optional(),
  name: z.text({ maxLength: 128 }).optional(),
  input: z.record(z.text(), z.any()).optional(),
  isError: z.boolean().optional(),
  message: z.text({ size: "long" }).optional(),
  reason: z.enum(["stop", "length", "paused"]).optional(),
});

export type AiStreamEvent = Infer<typeof aiStreamEventSchema>;

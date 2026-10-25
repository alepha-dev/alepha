import { type Infer, z } from "alepha";

/**
 * A stored message as the client reads it. A user message's page-context
 * block is stripped: it is what the model saw, not what the person typed.
 */
export const aiMessageResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.text({ size: "rich" }),
  toolCalls: z
    .array(
      z.object({
        id: z.text({ maxLength: 128 }),
        name: z.text({ maxLength: 64 }),
        input: z.record(z.text(), z.any()),
      }),
    )
    .optional(),
  callId: z.text({ maxLength: 128 }).optional(),
  name: z.text({ maxLength: 64 }).optional(),
  isError: z.boolean().optional(),
});

export type AiMessageResource = Infer<typeof aiMessageResourceSchema>;

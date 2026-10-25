import { type Infer, z } from "alepha";

/**
 * The call a paused conversation waits on: a mutation awaiting the user's
 * approval (`confirm`) or a tool the browser runs (`client_tool`). `input`
 * is the model's, stored with the pause: an approval runs exactly this.
 */
export const aiPendingCallSchema = z.object({
  callId: z.text({ maxLength: 128 }),
  name: z.text({ maxLength: 64 }),
  input: z.record(z.text(), z.any()),
  kind: z.enum(["confirm", "client_tool"]),
});

export type AiPendingCallResource = Infer<typeof aiPendingCallSchema>;

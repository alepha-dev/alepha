import { type Infer, z } from "alepha";

/**
 * The answer to a pause: a `decision` on a confirmation, or a client tool's
 * `result`, exactly one of the two. Only the call id travels with a
 * decision, never the input: an approval runs the input stored with the
 * pause.
 *
 * One object with two optional keys rather than a union, because an `$sse`
 * body is an object schema; `AiChatService.toResume` enforces the "exactly
 * one".
 */
export const aiResumeBodySchema = z.object({
  callId: z.text({ maxLength: 128 }),
  decision: z.enum(["approve", "deny"]).optional(),
  result: z.any().optional(),
});

export type AiResumeBody = Infer<typeof aiResumeBodySchema>;

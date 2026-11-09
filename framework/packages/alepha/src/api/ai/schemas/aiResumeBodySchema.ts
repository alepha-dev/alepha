import { type Infer, z } from "alepha";

import { aiPageContextSchema } from "./aiPageContextSchema.ts";

/**
 * The answer to a pause: a `decision` on a confirmation, or a client tool's
 * `result`, exactly one of the two. Only the call id travels with a
 * decision, never the input: an approval runs the input stored with the
 * pause.
 *
 * One object with two optional keys rather than a union, because an `$sse`
 * body is an object schema; `AiChatService.toResume` enforces the "exactly
 * one".
 *
 * `context` is the page the user answers from, as a chat carries it: the
 * assistant's `allow` reads it, so the tools offered on the resume are the
 * ones the paused turn offered. Client-supplied, never a security input.
 */
export const aiResumeBodySchema = z.object({
  callId: z.text({ maxLength: 128 }),
  decision: z.enum(["approve", "deny"]).optional(),
  result: z.any().optional(),
  context: aiPageContextSchema.optional(),
});

export type AiResumeBody = Infer<typeof aiResumeBodySchema>;

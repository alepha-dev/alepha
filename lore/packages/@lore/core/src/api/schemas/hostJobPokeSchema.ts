import { type Infer, z } from "alepha";

/**
 * One message a member sent a running agent job (#Q4456), as its page
 * shows it in the transcript: who sent what, when, and what became of the
 * `job-message` on the host (`done` once Bay wrote it to the agent).
 */
export const hostJobPokeSchema = z.object({
  at: z.string(),
  by: z.uuid().optional(),
  byName: z.string().optional(),
  message: z.string(),
  status: z.string(),
  reason: z.string().optional(),
});

export type HostJobPoke = Infer<typeof hostJobPokeSchema>;

import { type Infer, z } from "alepha";

import { projectGitHubConnectionSchema } from "./projectGitHubConnectionSchema.ts";

/**
 * Whether a project can connect GitHub, and what it is connected to
 * (#Q4362). `available` is false while the instance has no GitHub App:
 * settings then say the integration is unavailable.
 */
export const projectGitHubStatusSchema = z.object({
  available: z.boolean(),
  connection: projectGitHubConnectionSchema.optional(),
});

export type ProjectGitHubStatus = Infer<typeof projectGitHubStatusSchema>;

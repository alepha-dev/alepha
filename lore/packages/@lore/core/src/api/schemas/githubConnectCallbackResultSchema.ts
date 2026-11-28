import { type Infer, z } from "alepha";

import { projectGitHubConnectionSchema } from "./projectGitHubConnectionSchema.ts";

/**
 * What the install callback came to (#Q4362): connected at once (the
 * installation holds one repository the member reaches), a choice among
 * several (with a one-time `pick` that remembers which ones were proven), or
 * a request an organization owner has to approve.
 */
export const githubConnectCallbackResultSchema = z.object({
  outcome: z.enum(["connected", "choose", "requested"]),
  projectId: z.integer(),
  projectSlug: z.string(),
  connection: projectGitHubConnectionSchema.optional(),
  pick: z.string().optional(),
  repositories: z
    .array(
      z.object({
        id: z.integer(),
        fullName: z.string(),
        private: z.boolean(),
      }),
    )
    .optional(),
});

export type GitHubConnectCallbackResult = Infer<
  typeof githubConnectCallbackResultSchema
>;

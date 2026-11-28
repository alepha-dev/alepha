import { type Infer, z } from "alepha";

/**
 * Connect one repository (#Q4362): from the install callback's choice
 * (`pick`, proven by the member's user token), or by an installation a
 * member of this project already connected through (`installationId`, the
 * CLI's way, which has no user code).
 */
export const githubConnectBodySchema = z.object({
  repositoryId: z.integer().min(1),
  pick: z.string().min(1).max(200).optional(),
  installationId: z.integer().min(1).optional(),
});

export type GitHubConnectBody = Infer<typeof githubConnectBodySchema>;

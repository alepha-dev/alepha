import { type Infer, z } from "alepha";

/**
 * What GitHub hands back to Admin > GitHub after the App is created
 * (#Q4360): the one-time `code` and Lore's own `state`.
 */
export const githubManifestCompleteBodySchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  state: z.string().min(1).max(200),
});

export type GitHubManifestCompleteBody = Infer<
  typeof githubManifestCompleteBodySchema
>;

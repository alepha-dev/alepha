import { type Infer, z } from "alepha";

/**
 * The App's install page for one project, with Lore's signed state
 * (#Q4362). GitHub sends the member back to `/github/connect`.
 */
export const githubInstallLinkSchema = z.object({ url: z.string() });

export type GitHubInstallLink = Infer<typeof githubInstallLinkSchema>;

import { type Infer, z } from "alepha";

/**
 * What the browser posts to GitHub to create the App (#Q4360): the form's
 * `action`, with Lore's signed `state` in its query, and the manifest as
 * the one JSON field GitHub reads.
 */
export const githubManifestStartSchema = z.object({
  action: z.string(),
  manifest: z.string(),
  state: z.string(),
});

export type GitHubManifestStart = Infer<typeof githubManifestStartSchema>;

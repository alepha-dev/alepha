import { type Infer, z } from "alepha";

/**
 * The admin's choices before the App is created (#Q4360): the App's name on
 * GitHub (unique there, 34 characters at most), and the organization that
 * owns it, or none for the admin's own account. `public` (#Q4561, true when
 * absent) lets any account install the App: a private one installs only on
 * its owner's account.
 */
export const githubManifestStartBodySchema = z.object({
  name: z.string().trim().min(1).max(34).optional(),
  organization: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
    .optional(),
  public: z.boolean().optional(),
});

export type GitHubManifestStartBody = Infer<
  typeof githubManifestStartBodySchema
>;

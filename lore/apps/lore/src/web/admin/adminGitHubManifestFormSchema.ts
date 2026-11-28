import { z } from "alepha";

/**
 * Admin > GitHub's create form (#Q4360): the App's name on GitHub, and the
 * organization that owns it, empty for the admin's own account. The server
 * checks both again. `public` (#Q4561) lets any account install the App.
 */
export const adminGitHubManifestFormSchema = z.object({
  name: z.text({ maxLength: 34 }).optional(),
  organization: z.text({ maxLength: 39 }).optional(),
  public: z.boolean(),
});

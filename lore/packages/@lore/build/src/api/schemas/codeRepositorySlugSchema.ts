import { z } from "alepha";

/**
 * A repository's name in its clone URL, `/<project>/<slug>.git`: lowercase
 * letters, digits and inner hyphens, as a project slug. No dot, so a segment
 * ending in `.git` always means a repository and never a page.
 */
export const codeRepositorySlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Lowercase letters, digits and hyphens, starting and ending with a letter or a digit.",
  );

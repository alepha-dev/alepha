import { AlephaError, z } from "alepha";

/**
 * The one repository a project's commits live in.
 *
 * A full absolute URL rather than a slug plus a provider setting, because
 * **one project is one repository, always** (owner's call, 2026-08-29). The
 * slug-plus-provider shape existed to survive a project spanning several
 * repositories, and that case is ruled out rather than designed for.
 *
 * No provider field either: `/commit/<sha>` is correct on GitHub and Gitea,
 * and GitLab redirects it to `/-/commit/<sha>`.
 *
 * ⚠️ A bare `feunard/alepha` is a stated error, not a silently broken link.
 * It is the shape a person most plausibly types, and the failure it produces
 * without this rule is a href that resolves against lore.alepha.dev.
 *
 * The trailing slash is stripped on the way in so the rail can append a path
 * without guessing whether it already has one. Query and hash are refused for
 * the same reason: everything after the repository root is Lore's to add.
 *
 * ⚠️ Enforced on **write only**, like `projectTitleSchema`. Never validate a
 * stored value on read.
 */
export const projectRepositoryUrlSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value.replace(/\/+$/, ""))
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new AlephaError(
          "The repository must be a full URL, such as https://github.com/you/your-repo",
        );
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new AlephaError("The repository URL must be http or https");
      }
      if (url.search || url.hash) {
        throw new AlephaError(
          "The repository URL must be the repository's root, with no query or fragment",
        );
      }
      return true;
    },
    { message: "Invalid repository URL" },
  );

import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `github_connect` (#Q4362): a repository of an installation a member of the
 * project already connected through. A first connection is made in the
 * browser, whose install callback proves the member reaches the repository.
 */
export const githubConnectParamsSchema = projectParamsSchema.extend({
  installation_id: z
    .integer()
    .describe(
      "The GitHub App installation, one a member of this project already connected a repository through (github_status shows the current one).",
    ),
  repository_id: z
    .integer()
    .describe("GitHub's numeric id of the repository to connect."),
});

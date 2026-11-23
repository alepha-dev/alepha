import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { codeRepositoryDetailSchema } from "../schemas/codeRepositoryDetailSchema.ts";
import { codeRepositorySlugSchema } from "../schemas/codeRepositorySlugSchema.ts";
import { CodeBrowserService } from "../services/CodeBrowserService.ts";
import { CodeReadAccess } from "../services/CodeReadAccess.ts";
import { CodeRepositoryService } from "../services/CodeRepositoryService.ts";

/**
 * The code browser's reads (#E167): what the pages under `/<project>/code`
 * and the `code_*` tools call.
 *
 * Every action is `code:read` (`$ownsProject`) and 404s with Build's
 * `repositories` off or for a repository a job key is not pinned to
 * (`CodeReadAccess`). Action names are the CLI's wire contract.
 */
export class CodeBrowserController {
  protected readonly access = $inject(CodeReadAccess);
  protected readonly browser = $inject(CodeBrowserService);
  protected readonly repositories = $inject(CodeRepositoryService);

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "code:read" });

  getCodeRepository = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug",
    description:
      "A repository's branches, tags and the default branch's last commit.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        slug: codeRepositorySlugSchema,
      }),
      response: codeRepositoryDetailSchema,
    },
    handler: async ({ params, user, url }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      return this.browser.detail(row, this.repositories.baseUrl(url));
    },
  });
}

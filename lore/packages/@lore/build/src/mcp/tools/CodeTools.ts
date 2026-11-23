import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { CodeRepositoryController } from "../../api/controllers/CodeRepositoryController.ts";
import { codeRepositorySchema } from "../../api/schemas/codeRepositorySchema.ts";
import {
  codeRepoCreateParamsSchema,
  codeRepoDeleteParamsSchema,
  codeRepoDeleteResultSchema,
  codeRepoListParamsSchema,
  codeRepoListResultSchema,
} from "../schemas/codeSchemas.ts";

/**
 * A project's git repositories over MCP (#Q3934), on the actions `lore code
 * repo list|create|delete` calls, and never more (the parity rule).
 *
 * An MCP token never holds `code:admin` (`LoreOAuthScopes.PARTIAL_GROUPS`),
 * so `code_repo_create` and `code_repo_delete` answer 403 to every MCP
 * token: they exist so an agent learns to run `lore code repo create` with a
 * `lore login` instead, and with an API key they work.
 */
export class CodeTools {
  protected readonly repositories = $inject(CodeRepositoryController);
  protected readonly projects = $inject(ProjectTools);

  code_repo_list = $tool({
    title: "List git repositories",
    description:
      "The project's git repositories on Lore, each with its HTTPS clone URL (`/<project>/<repo>.git`, or `/<project>.git` for the one named like the project). Clone with `lore clone <project>[/<repo>]`, which installs the credential helper. Needs `code:read`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: codeRepoListParamsSchema,
      result: codeRepoListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return this.repositories.listCodeRepositories({
        params: { projectId },
        query: {},
      });
    },
  });

  code_repo_create = $tool({
    title: "Create a git repository",
    description:
      "Create an empty git repository in the project (Build must be on). Needs `code:admin`, which no MCP token carries: over MCP it answers 403, and `lore code repo create` with a `lore login` (as a project Admin) or an API key creates it.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: codeRepoCreateParamsSchema,
      result: codeRepositorySchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return this.repositories.createCodeRepository({
        params: { projectId },
        body: {
          slug: params.slug,
          ...(params.default_branch
            ? { defaultBranch: params.default_branch }
            : {}),
        },
      });
    },
  });

  code_repo_delete = $tool({
    title: "Delete a git repository",
    description:
      "Delete a git repository and everything in it, for good. Needs `code:admin`, which no MCP token carries: over MCP it answers 403, and `lore code repo delete` with a `lore login` (as a project Admin) or an API key deletes it.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: codeRepoDeleteParamsSchema,
      result: codeRepoDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return this.repositories.deleteCodeRepository({
        params: { projectId, slug: params.slug },
      });
    },
  });
}

import { $ownsProject } from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { OwnedResourceProvider } from "alepha/security";
import { $action } from "alepha/server";

import { requirementsPromptKindSchema } from "../schemas/requirementsPromptKindSchema.ts";
import { RequirementsPromptService } from "../services/RequirementsPromptService.ts";

/**
 * The Verify prompt (#E153): one action behind the dialog, `usecase_prompt`
 * and `lore usecase prompt`. It runs nothing: it answers the prompt to paste
 * into an agent and the command line that prints it again.
 *
 * Verify is how Requirements works, so `requirements` is the gate
 * (decision 29).
 */
export class RequirementsPromptController {
  protected readonly service = $inject(RequirementsPromptService);
  protected readonly owned = $inject(OwnedResourceProvider);

  renderRequirementsPrompt = $action({
    method: "GET",
    path: "/renderRequirementsPrompt/:projectId",
    use: [
      $ownsProject({
        requires: "usecase:read",
        param: "projectId",
      }),
    ],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        kind: requirementsPromptKindSchema,
        useCaseNumber: z.integer().optional(),
        personaNumber: z.integer().optional(),
        folioShortId: z.integer().optional(),
        requirementNumber: z.integer().optional(),
        epicNumber: z.integer().optional(),
        staleOnly: z.boolean().optional(),
        app: z.text().optional(),
        env: z.text().optional(),
        asPersona: z.integer().optional(),
      }),
      response: z.object({
        kind: requirementsPromptKindSchema,
        prompt: z.string(),
        command: z.string(),
      }),
    },
    handler: async ({ query }) =>
      await this.service.render({
        project: this.owned.authority<Project>(),
        ...query,
      }),
  });
}

import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import {
  personaAppCopySchema,
  personaChangesSchema,
  personaShowcaseSchema,
} from "../schemas/personaInsightSchemas.ts";
import { PersonaInsightService } from "../services/PersonaInsightService.ts";
import { PersonaController } from "./PersonaController.ts";

/**
 * A persona's scope changes, where "Open as" leads, and its showcase
 * (#E153). Reads only, open to `persona:read`.
 */
export class PersonaInsightController {
  protected readonly insights = $inject(PersonaInsightService);
  protected readonly personas = $inject(PersonaController);

  protected ownsProject = () =>
    $ownsProject({ requires: "persona:read", param: "projectId" });

  getPersonaChanges = $action({
    method: "GET",
    path: "/getPersonaChanges/:projectId/:number",
    use: [this.ownsProject()],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: personaChangesSchema,
    },
    handler: async ({ params }) =>
      await this.insights.changesOf(
        await this.personas.byNumber(params.projectId, params.number),
      ),
  });

  getPersonaAppCopy = $action({
    method: "GET",
    path: "/getPersonaAppCopy/:projectId/:number",
    use: [this.ownsProject()],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: personaAppCopySchema,
    },
    handler: async ({ params }) =>
      await this.insights.appCopyOf(
        await this.personas.byNumber(params.projectId, params.number),
      ),
  });

  getPersonaShowcase = $action({
    method: "GET",
    path: "/getPersonaShowcase/:projectId/:number",
    use: [this.ownsProject()],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: personaShowcaseSchema,
    },
    handler: async ({ params }) =>
      await this.insights.showcaseOf(
        await this.personas.byNumber(params.projectId, params.number),
      ),
  });
}

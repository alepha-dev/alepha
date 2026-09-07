import { $inject, Alepha, z } from "alepha";
import { $action } from "alepha/server";

import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectRankPresets } from "../security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The one thing the rank editor needs that `alepha/api/ranks` cannot answer.
 *
 * The module ships the catalogue, the rank list and the four writes; none of
 * that is Lore-shaped. A **preset** is: it is computed from the project's
 * enabled capabilities, so a Contributor of a Knowledge-only project comes out
 * carrying folio writes and nothing else, and neither the module nor the
 * browser is in a position to work that out.
 *
 * ⚠️ One endpoint, not a copy of the computation in the page.
 * {@link ProjectRankPresets} is the single place these three sets are defined,
 * and it is the same call `createProject` makes when it seeds a new project -
 * which is what stops "create from a preset" and "what a new project starts
 * with" from drifting into offering different Contributors.
 */
export class ProjectRankController {
  protected readonly alepha = $inject(Alepha);
  protected readonly presets = $inject(ProjectRankPresets);
  protected readonly security = $inject(ProjectSecurityService);

  getRankPresets = $action({
    // Same permission as the editor itself: a preset is a rank somebody is
    // about to create, and offering the shape of one to a reader who cannot
    // create it is an affordance that answers 403.
    use: [$ownsProject({ param: "projectId", requires: "rank:manage" })],
    method: "GET",
    path: "/projects/:projectId/rank-presets",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(
          z.object({
            key: z.text(),
            name: z.text(),
            permissions: z.array(z.text()),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const enabled = await this.security.capabilitiesOf(params.projectId);
      const language = this.alepha.store.get("alepha.http.request")?.language;

      return {
        items: this.presets
          .presetsFor(Object.keys(enabled) as never)
          .map((preset) => ({
            key: preset.key,
            // Resolved server-side for the same reason seeding does it there:
            // `nameFor` reads the locale catalogues, and the name it produces
            // is stored once and then belongs to whoever renamed it.
            name: this.presets.nameFor(preset, language),
            permissions: preset.permissions,
          })),
      };
    },
  });
}

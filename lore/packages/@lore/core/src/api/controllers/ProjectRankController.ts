import { $inject, Alepha, z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $action } from "alepha/server";

import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectRankPresets } from "../security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The one thing the rank editor needs that `alepha/api/organizations` cannot answer.
 *
 * The module ships the catalogue, the rank list and the four writes; none of
 * that is Lore-shaped. The **bases** a new rank starts from are: since
 * #Q3661 a new rank starts from admin, member or viewer, copying what that
 * rank holds in THIS project right now, so an owner who widened their Admin
 * gets the widened set and not a template.
 *
 * A project that lacks `admin` or `viewer` (created before every project had
 * them, until the nightly sweep reaches it) is offered the preset instead,
 * computed from its enabled capabilities by {@link ProjectRankPresets}, the
 * same call `createProject` seeds with.
 */
export class ProjectRankController {
  protected readonly alepha = $inject(Alepha);
  protected readonly presets = $inject(ProjectRankPresets);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly ranks = $inject(RankService);

  /**
   * The ranks a new rank may start from, in the order the menu lists them.
   */
  public static readonly BASES = ["admin", "member", "viewer"] as const;

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
      const held = await this.ranks.ranksOf(
        await this.security.organizationIdOf(params.projectId),
      );
      const presets = this.presets.presetsFor(Object.keys(enabled) as never);

      const items = [];
      for (const key of ProjectRankController.BASES) {
        const rank = held.find((it) => it.key === key);
        if (rank) {
          items.push({
            key,
            name: rank.name,
            permissions: [...rank.permissions],
          });
          continue;
        }
        const preset = presets.find((it) => it.key === key);
        if (!preset) continue;
        items.push({
          key,
          // The name seeding would store: English (#Q3744).
          name: this.presets.nameFor(preset),
          permissions: preset.permissions,
        });
      }
      return { items };
    },
  });
}

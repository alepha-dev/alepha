import { type Alepha, AlephaError } from "alepha";
import { RankService } from "alepha/api/organizations";

import { ProjectRankPresets } from "@/api/security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "@/api/services/ProjectSecurityService.ts";

/**
 * Create Admin, Contributor and Viewer in a project, the way its owner would
 * from Settings > Ranks > Create rank.
 *
 * A project starts with `owner` and `member` only since #Q2511, so a spec
 * that puts somebody on `contributor` has to create that rank first, or the
 * key names nothing. The keys are the preset keys (`admin`, `contributor`,
 * `viewer`), which the UI does not use (it mints `r<time>`): a stable key is
 * what lets a spec name the rank.
 *
 * Written through `RankService.save` as the project's owner, so the module's
 * invariants run on the presets exactly as they would for a click.
 */
export const createPresetRanks = async (
  alepha: Alepha,
  projectId: number,
): Promise<void> => {
  const security = alepha.inject(ProjectSecurityService);
  const presets = alepha.inject(ProjectRankPresets);
  const ranks = alepha.inject(RankService);

  const organizationId = await security.organizationIdOf(projectId);
  const owner = await security.members.findOne({
    where: { organizationId: { eq: organizationId }, rank: { eq: "owner" } },
  });
  if (!owner) {
    throw new AlephaError(
      `project ${projectId} has no owner to create ranks as`,
    );
  }
  const enabled = Object.keys(await security.capabilitiesOf(projectId));

  // Its own context: `RankService` memoizes the writer's membership on the
  // store, and none is seeded outside a request.
  await alepha.context.run(async () => {
    for (const preset of presets.presetsFor(enabled as never)) {
      await ranks.save(
        organizationId,
        {
          key: preset.key,
          name: await presets.nameFor(preset),
          permissions: preset.permissions,
        },
        { id: owner.userId } as never,
      );
    }
  });
};

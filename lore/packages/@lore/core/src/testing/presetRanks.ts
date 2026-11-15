import { type Alepha, AlephaError } from "alepha";
import { RankService } from "alepha/api/organizations";

import { CapabilityRegistry } from "../api/schemas/CapabilityRegistry.ts";
import { ProjectRankPresets } from "../api/security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "../api/services/ProjectSecurityService.ts";

/**
 * Give a project Admin and Viewer, the default ranks (#Q3661), and the
 * Contributor rank a project created before #Q3661 may still hold.
 *
 * A project made through `createProject` is seeded with Admin and Viewer
 * already; one made by `createTestProject` writes rows and is not, so a spec
 * that puts somebody on `viewer` creates the ranks first, or the key names
 * nothing.
 *
 * `contributor` is no longer a preset (Member covers it), but existing
 * projects keep theirs as a custom rank, and a spec about one of them names
 * it: {@link LEGACY_CONTRIBUTOR} is the set that rank was seeded with.
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
  const registry = alepha.inject(CapabilityRegistry);

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
        { id: owner.userId },
      );
    }
    await ranks.save(
      organizationId,
      {
        key: "contributor",
        name: "Contributor",
        permissions: LEGACY_CONTRIBUTOR.filter((permission) => {
          const capability = registry.ownerOfPermissionGroup(
            permission.split(":")[0],
          );
          return !capability || enabled.includes(capability);
        }),
      },
      { id: owner.userId },
    );
  });
};

/**
 * What the Contributor preset granted until #Q3661 removed it: the work,
 * written, and no configuration. Kept for the specs about projects that
 * still hold such a rank.
 */
export const LEGACY_CONTRIBUTOR: string[] = [
  "project:read",
  "member:read",
  "stats:read",
  "quest:read",
  "quest:create",
  "quest:update",
  "quest:delete",
  "epic:read",
  "epic:write",
  "release:read",
  "area:read",
  "folio:read",
  "folio:write",
  "app:read",
  "artifact:read",
  "artifact:push",
  "error:read",
  "quality:read",
  "quality:push",
  "host:read",
  "feedback:read",
  "automation:read",
  "automation:write",
];

import { OrganizationRanks } from "@alepha/ui/organizations";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectRankController } from "@/api/controllers/ProjectRankController.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { LoreRankBounds } from "@/api/security/LoreRankBounds.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { capabilityRegistry } from "@/web/app/services/capabilityRegistry.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

const ProjectSettingsRanksPage = () => {
  const presetApi = useClient<ProjectRankController>();
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const projectId = project?.id;
  const presets =
    useQuery(
      {
        enabled: projectId !== undefined,
        handler: () =>
          presetApi.getRankPresets({
            params: { projectId: projectId as number },
          }),
      },
      [presetApi, projectId],
    ).data?.items ?? [];

  if (!project) return null;

  const enabled = (project.capabilities ?? []).map(
    (capability) => capability.key,
  ) as CapabilityKey[];
  const held = project.permissions ?? [];

  return (
    <OrganizationRanks
      organizationId={project.organizationId}
      presets={presets}
      filterPermission={(permission, group) => {
        if (!group.label) return false;
        const owner = capabilityRegistry.ownerOfPermissionGroup(group.name);
        return (
          capabilityRegistry.isOwnerEnabled(owner, enabled) &&
          !LoreRankBounds.OUT_OF_SCOPE.includes(permission.name) &&
          !LoreRankBounds.OWNER_ONLY.includes(permission.name)
        );
      }}
      lockPermission={(permission) => {
        if (LoreRankBounds.FLOOR.includes(permission.name)) return "on";
        const granted = held.some(
          (value) =>
            value === "*" ||
            value === permission.name ||
            (value.endsWith("*") &&
              permission.name.startsWith(value.slice(0, -1))),
        );
        return granted ? undefined : "off";
      }}
      label={(key, fallback) => (key ? tr(key as never) : fallback)}
    />
  );
};

export default ProjectSettingsRanksPage;

import { OrganizationMembers } from "@alepha/ui/organizations";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { useRank } from "@/web/app/components/shared/useRank.ts";

import type { AppRouter } from "../../../AppRouter.ts";

const ProjectSettingsMembersPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { can } = useRank();
  const router = useRouter<AppRouter>();

  if (!project) return null;

  return (
    <OrganizationMembers
      organizationId={project.organizationId}
      can={can}
      onLeft={() => router.push("home")}
    />
  );
};

export default ProjectSettingsMembersPage;

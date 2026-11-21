import { OrganizationMembers } from "@alepha/ui/organizations";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { useRank } from "../../shared/useRank.ts";

const ProjectSettingsMembersPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { can } = useRank();
  const router = useRouter();

  if (!project) return null;

  return (
    // Half the settings body's gutter (#Q4053): the member list, like the
    // Ranks matrix beside it, reads as a list, not a column of setting
    // blocks, and the full 24px made it look inset next to the tables.
    <div className="-m-2 flex flex-col gap-6 md:-m-3">
      <OrganizationMembers
        organizationId={project.organizationId}
        can={can}
        onLeft={() => router.push("home")}
      />
    </div>
  );
};

export default ProjectSettingsMembersPage;

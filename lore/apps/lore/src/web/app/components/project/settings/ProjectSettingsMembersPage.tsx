import type {
  OrganizationInvitation,
  OrganizationMember,
} from "alepha/api/organizations";
import { useStore } from "alepha/react";

import type { User } from "@/api/entities/users.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import ProjectSettingsMembersSection from "./ProjectSettingsMembersSection.tsx";

export interface ProjectSettingsMembersPageProps {
  members: Array<OrganizationMember & { user: User }>;
  pendingInvitations: Array<OrganizationInvitation>;
}

const ProjectSettingsMembersPage = (props: ProjectSettingsMembersPageProps) => {
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  return (
    <ProjectSettingsMembersSection
      project={project}
      members={props.members}
      pendingInvitations={props.pendingInvitations}
    />
  );
};

export default ProjectSettingsMembersPage;

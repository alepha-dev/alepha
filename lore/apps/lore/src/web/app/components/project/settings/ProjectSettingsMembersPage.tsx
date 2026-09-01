import type { InvitationEntity } from "alepha/api/invitations";
import { useStore } from "alepha/react";

import type { Member } from "@/api/entities/members.ts";
import type { User } from "@/api/entities/users.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import ProjectSettingsMembersSection from "./ProjectSettingsMembersSection.tsx";

export interface ProjectSettingsMembersPageProps {
  members: Array<Member & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
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

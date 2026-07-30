import { useStore } from "alepha/react";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { Member } from "@/api/entities/members.ts";
import type { User } from "@/api/entities/users.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import CampaignSettingsMembersSection from "./CampaignSettingsMembersSection.tsx";

export interface CampaignSettingsMembersPageProps {
  members: Array<Member & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const CampaignSettingsMembersPage = (
  props: CampaignSettingsMembersPageProps,
) => {
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) {
    return null;
  }

  return (
    <CampaignSettingsMembersSection
      campaign={campaign}
      members={props.members}
      pendingInvitations={props.pendingInvitations}
    />
  );
};

export default CampaignSettingsMembersPage;

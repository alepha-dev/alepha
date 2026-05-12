import { useStore } from "alepha/react";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { User } from "@/api/entities/users.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import CampaignSettingsAdventurersSection from "./CampaignSettingsAdventurersSection.tsx";

export interface CampaignSettingsAdventurersPageProps {
  adventurers: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const CampaignSettingsAdventurersPage = (
  props: CampaignSettingsAdventurersPageProps,
) => {
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) {
    return null;
  }

  return (
    <CampaignSettingsAdventurersSection
      campaign={campaign}
      adventurers={props.adventurers}
      pendingInvitations={props.pendingInvitations}
    />
  );
};

export default CampaignSettingsAdventurersPage;

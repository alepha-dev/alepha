import { useStore } from "alepha/react";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { User } from "@/api/entities/users.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import CampaignSettingsCharactersSection from "./CampaignSettingsCharactersSection.tsx";

export interface CampaignSettingsCharactersPageProps {
  characters: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const CampaignSettingsCharactersPage = (
  props: CampaignSettingsCharactersPageProps,
) => {
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) {
    return null;
  }

  return (
    <CampaignSettingsCharactersSection
      campaign={campaign}
      characters={props.characters}
      pendingInvitations={props.pendingInvitations}
    />
  );
};

export default CampaignSettingsCharactersPage;

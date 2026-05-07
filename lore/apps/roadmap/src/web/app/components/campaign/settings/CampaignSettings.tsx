import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { User } from "@/api/entities/users.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "@/web/app/atoms/userCampaignsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignUpdate from "../CampaignUpdate.tsx";
import CampaignSettingsAdventurersSection from "./CampaignSettingsAdventurersSection.tsx";
import CampaignSettingsCharacterSection from "./CampaignSettingsCharacterSection.tsx";
import CampaignSettingsConfirmationModal from "./CampaignSettingsConfirmationModal.tsx";

export interface CampaignSettingsProps {
  campaign: Campaign;
  adventurers: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const CampaignSettings = (props: CampaignSettingsProps) => {
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const campaignApi = useClient<CampaignController>();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  if (!campaign) {
    return null;
  }

  const handleDelete = async () => {
    await campaignApi.deleteCampaignById({ params: { id: campaign.id } });
    alepha.store.set(
      userCampaignsAtom,
      (alepha.store.get(userCampaignsAtom) ?? []).filter(
        (p) => p.id !== campaign.id,
      ),
    );
    setDeleteModalOpen(false);
    router.push("home");
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div className="flex flex-col gap-6">
        {/* General */}
        <div className="flex flex-col gap-2">
          <span className="text-sm">
            {tr("campaign.settings.general.title")}
          </span>
          <CampaignUpdate campaign={campaign} />
        </div>

        {/* Character */}
        <CampaignSettingsCharacterSection />

        {/* Adventurers */}
        <CampaignSettingsAdventurersSection
          campaign={campaign}
          adventurers={props.adventurers}
          pendingInvitations={props.pendingInvitations}
        />

        {/* Danger Zone */}
        <div className="flex flex-col gap-2">
          <span className="text-sm">
            {tr("campaign.settings.danger.title")}
          </span>
          <Card className="bg-card shadow">
            <CardContent className="grid grid-cols-1 gap-4 p-4 xs:grid-cols-2">
              <div className="flex flex-col gap-0">
                <span className="text-sm">
                  {tr("campaign.settings.actions.delete")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("campaign.settings.actions.delete.helper")}
                </span>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  {tr("campaign.settings.actions.delete")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <CampaignSettingsConfirmationModal
          open={deleteModalOpen}
          campaign={campaign}
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={handleDelete}
        />
      </div>
    </div>
  );
};

export default CampaignSettings;

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "@/web/app/atoms/userCampaignsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsConfirmationModal from "./CampaignSettingsConfirmationModal.tsx";

const CampaignSettingsVault = () => {
  const alepha = useAlepha();
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();
  const campaignApi = useClient<CampaignController>();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  if (!campaign) {
    return null;
  }

  const isOwner = campaign.createdBy === auth.user?.id;

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

  const handleLeave = async () => {
    await campaignApi.leaveCampaign({ params: { id: campaign.id } });
    alepha.store.set(
      userCampaignsAtom,
      (alepha.store.get(userCampaignsAtom) ?? []).filter(
        (p) => p.id !== campaign.id,
      ),
    );
    setLeaveDialogOpen(false);
    router.push("home");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("campaign.settings.danger.title")}</span>
        <Card className="bg-card divide-y rounded-lg border py-0 shadow">
          {isOwner ? (
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("campaign.settings.actions.delete")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("campaign.settings.actions.delete.helper")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  {tr("campaign.settings.actions.delete")}
                </Button>
              </div>
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("campaign.settings.actions.leave")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("campaign.settings.actions.leave.helper")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="destructive"
                  onClick={() => setLeaveDialogOpen(true)}
                >
                  {tr("campaign.settings.actions.leave")}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <CampaignSettingsConfirmationModal
        open={deleteModalOpen}
        campaign={campaign}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
      />

      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(o) => !o && setLeaveDialogOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("campaign.settings.leave.modal.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("campaign.settings.leave.modal.description", {
                args: [campaign.title],
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaveDialogOpen(false)}>
              {tr("campaign.settings.leave.modal.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {tr("campaign.settings.leave.modal.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CampaignSettingsVault;

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
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { FeaturePaywallController } from "@/api/controllers/FeaturePaywallController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Owner-only debug section: rendered on the General settings page only
 * when the route carries `?debug` (mounted from
 * `CampaignSettingsGeneralPage`). Lets the campaign owner wipe the
 * `unlockedFeatures` + `unlockHistory` arrays so the paywall flow can
 * be re-exercised without recreating a campaign. The character's gold
 * balance is intentionally left untouched.
 */
const CampaignSettingsDebugSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [campaign] = useStore(currentCampaignAtom);
  const api = useClient<FeaturePaywallController>();
  const alepha = useAlepha();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!campaign) return null;

  const handleReset = async () => {
    setResetting(true);
    try {
      const next = await api.resetFeatures({
        params: { campaignId: campaign.id },
      });
      alepha.store.set(currentCampaignAtom, { ...campaign, ...next });
      toaster.success(tr("campaign.settings.debug.shopReset.success"));
      setConfirmOpen(false);
    } catch (err) {
      toaster.error(
        err instanceof Error
          ? err.message
          : tr("campaign.settings.debug.shopReset.error"),
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{tr("campaign.settings.debug.title")}</span>
      <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("campaign.settings.debug.shopReset.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("campaign.settings.debug.shopReset.subtitle")}
            </span>
          </div>
          <div className="flex justify-start sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={resetting}
            >
              <RotateCcw className="size-4" />
              {tr("campaign.settings.debug.shopReset.button")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !o && !resetting && setConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("campaign.settings.debug.shopReset.confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("campaign.settings.debug.shopReset.confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>
              {tr("campaign.settings.debug.shopReset.confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleReset();
              }}
              disabled={resetting}
            >
              {tr("campaign.settings.debug.shopReset.confirm.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CampaignSettingsDebugSection;

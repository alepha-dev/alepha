import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import {
  type CampaignFeatures,
  defaultCampaignFeatures,
} from "@/api/entities/campaigns.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "@/web/app/atoms/userCampaignsAtom.ts";

type FeatureKey = keyof CampaignFeatures;

export interface FeatureToggle {
  enabled: boolean;
  toggle: (value: boolean) => Promise<void>;
}

export const useCampaignFeatureToggle = (key: FeatureKey): FeatureToggle => {
  const alepha = useAlepha();
  const campaignApi = useClient<CampaignController>();
  const [campaign] = useStore(currentCampaignAtom);
  const [pending, setPending] = useState<boolean | undefined>(undefined);
  const toaster = useToast();

  const persisted = {
    ...defaultCampaignFeatures,
    ...campaign?.features,
  };
  // Optional schema keys (questNote/questReminder/...) read as
  // `undefined` for old rows that don't carry them yet — coerce to
  // false so the Switch never receives undefined.
  const enabled = pending ?? persisted[key] ?? false;

  const toggle = async (value: boolean) => {
    if (!campaign) return;
    setPending(value);
    try {
      const updated = await campaignApi.updateCampaignById({
        params: { id: campaign.id },
        body: { features: { [key]: value } },
      });
      alepha.store.set(currentCampaignAtom, updated);
      const overview = alepha.store.get(userCampaignsAtom);
      if (overview) {
        alepha.store.set(userCampaignsAtom, {
          ...overview,
          campaigns: overview.campaigns.map((p) =>
            p.id === updated.id ? updated : p,
          ),
        });
      }
      setPending(undefined);
    } catch (error) {
      setPending(undefined);
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  return { enabled, toggle };
};

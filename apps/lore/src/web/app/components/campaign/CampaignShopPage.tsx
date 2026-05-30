import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Circle, Lock, Sparkles } from "lucide-react";
import { useState } from "react";
import type { FeaturePaywallController } from "@/api/controllers/FeaturePaywallController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "@/web/app/atoms/currentCampaignCharacterAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

interface FeatureRow {
  key: string;
  label: string;
  description: string;
  price: number;
  unlocked: boolean;
  // Sponsored credit line from the audit log — display only, the field
  // name is kept so the audit data shape stays stable.
  sponsoredBy?: {
    characterId: number;
    price: number;
    at: string;
  };
}

interface CampaignShopPageProps {
  features: FeatureRow[];
}

const CampaignShopPage = (props: CampaignShopPageProps) => {
  const shopApi = useClient<FeaturePaywallController>();
  const toaster = useToast();
  const [campaign] = useStore(currentCampaignAtom);
  const [character] = useStore(currentCampaignCharacterAtom);
  const alepha = useAlepha();
  const { tr, l } = useI18n<I18n, "en">();
  const [features, setFeatures] = useState(props.features);
  const [pending, setPending] = useState<string | null>(null);

  if (!campaign) return null;

  const balanceGold = Math.floor((character?.balance ?? 0) / 100);

  const handleBuy = async (key: string) => {
    if (!character) return;
    setPending(key);
    try {
      const result = await shopApi.buyFeature({
        params: { campaignId: campaign.id, featureKey: key },
      });
      // Update local atoms so the rest of the UI sees the new state.
      alepha.store.set(currentCampaignAtom, {
        ...campaign,
        ...result.campaign,
      });
      alepha.store.set(currentCampaignCharacterAtom, result.character);
      setFeatures((rows) =>
        rows.map((row) =>
          row.key === key
            ? { ...row, unlocked: true, sponsoredBy: undefined }
            : row,
        ),
      );
      // Re-fetch to pull the freshly-stamped buyer credit.
      shopApi
        .listFeatures({ params: { campaignId: campaign.id } })
        .then(setFeatures)
        .catch(() => null);
      toaster.success(tr("shop.buy.success"));
    } catch (err: any) {
      toaster.error(err?.message || "Failed to buy");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-semibold">{tr("shop.title")}</h2>
        <p className="text-muted-foreground text-sm">{tr("shop.subtitle")}</p>
      </div>
      <div className="flex flex-col gap-2">
        {features.map((feature) => (
          <Card key={feature.key} className="py-3 shadow">
            <CardContent className="flex flex-col gap-2 px-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{feature.label}</span>
                  {feature.unlocked ? (
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles className="size-3" />
                      {tr("shop.owned")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="size-3" />
                      {tr("shop.locked")}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {feature.description}
                </p>
                {feature.unlocked && feature.sponsoredBy && (
                  <p className="text-muted-foreground text-xs">
                    {tr("shop.boughtBy", {
                      args: [
                        String(feature.sponsoredBy.characterId),
                        String(feature.sponsoredBy.price),
                        String(l(feature.sponsoredBy.at, { date: "ll" })),
                      ],
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-sm">
                  <Circle
                    className="size-2 fill-current"
                    style={{ color: "var(--color-gold)" }}
                  />
                  <span className="font-medium">{feature.price}g</span>
                </div>
                {!feature.unlocked && (
                  <Button
                    size="sm"
                    disabled={
                      pending === feature.key ||
                      balanceGold < feature.price ||
                      !character
                    }
                    onClick={() => handleBuy(feature.key)}
                  >
                    {tr("shop.buy")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {character && (
        <p className="text-muted-foreground text-xs mt-2">
          {tr("shop.yourBalance", { args: [String(balanceGold)] })}
        </p>
      )}
    </div>
  );
};

export default CampaignShopPage;

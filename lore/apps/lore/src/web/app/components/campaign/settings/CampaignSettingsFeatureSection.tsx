import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useI18n } from "alepha/react/i18n";
import type { CampaignFeatures } from "@/api/entities/campaigns.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type FeatureKey = keyof CampaignFeatures;

export interface CampaignSettingsFeatureSectionProps {
  featureKey: FeatureKey;
  enabled: boolean;
  onToggle: (value: boolean) => void | Promise<void>;
}

const DESCRIPTION_KEYS: Record<
  FeatureKey,
  | "campaign.settings.feature.kanban.description"
  | "campaign.settings.feature.folios.description"
  | "campaign.settings.feature.petitions.description"
  | "campaign.settings.feature.chapters.description"
> = {
  kanban: "campaign.settings.feature.kanban.description",
  folios: "campaign.settings.feature.folios.description",
  petitions: "campaign.settings.feature.petitions.description",
  chapters: "campaign.settings.feature.chapters.description",
};

const NAV_KEYS: Record<
  FeatureKey,
  | "campaign.settings.nav.kanban"
  | "campaign.settings.nav.folios"
  | "campaign.settings.nav.petitions"
  | "campaign.settings.nav.chapters"
> = {
  kanban: "campaign.settings.nav.kanban",
  folios: "campaign.settings.nav.folios",
  petitions: "campaign.settings.nav.petitions",
  chapters: "campaign.settings.nav.chapters",
};

const CampaignSettingsFeatureSection = (
  props: CampaignSettingsFeatureSectionProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const label = tr(NAV_KEYS[props.featureKey]);
  const description = tr(DESCRIPTION_KEYS[props.featureKey]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="py-4 shadow">
        <CardContent className="flex items-center justify-between gap-4 px-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-muted-foreground text-xs">{description}</span>
          </div>
          <Switch
            checked={props.enabled}
            onCheckedChange={(value) => {
              void props.onToggle(value);
            }}
            aria-label={String(tr("campaign.settings.feature.enable"))}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignSettingsFeatureSection;

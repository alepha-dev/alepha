import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useI18n } from "alepha/react/i18n";
import type { CampaignFeatures } from "@/api/entities/campaigns.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

// Limited to the legacy module-level toggles that drive a dedicated
// settings sub-page. Per-quest toggles (questNote / questReminder /
// questChrono) live on the Quests settings page and render via a
// dedicated row component, not this section.
type ModuleFeatureKey =
  | "kanban"
  | "folios"
  | "chapters"
  | "sigils"
  | "outposts";

// Compile-time guarantee that ModuleFeatureKey stays a subset of
// CampaignFeatures keys — if a key gets renamed in the entity, the
// `satisfies` clause forces this file to update too.
type _Check = ModuleFeatureKey extends keyof CampaignFeatures ? true : never;
const _moduleFeatureKeyCheck: _Check = true;
void _moduleFeatureKeyCheck;

export interface CampaignSettingsFeatureSectionProps {
  featureKey: ModuleFeatureKey;
  enabled: boolean;
  onToggle: (value: boolean) => void | Promise<void>;
}

const DESCRIPTION_KEYS: Record<
  ModuleFeatureKey,
  | "campaign.settings.feature.kanban.description"
  | "campaign.settings.feature.folios.description"
  | "campaign.settings.feature.chapters.description"
  | "campaign.settings.feature.sigils.description"
  | "campaign.settings.feature.outposts.description"
> = {
  kanban: "campaign.settings.feature.kanban.description",
  folios: "campaign.settings.feature.folios.description",
  chapters: "campaign.settings.feature.chapters.description",
  sigils: "campaign.settings.feature.sigils.description",
  outposts: "campaign.settings.feature.outposts.description",
};

const NAV_KEYS: Record<
  ModuleFeatureKey,
  | "campaign.settings.nav.kanban"
  | "campaign.settings.nav.folios"
  | "campaign.settings.nav.chapters"
  | "campaign.settings.nav.sigils"
  | "campaign.settings.nav.outposts"
> = {
  kanban: "campaign.settings.nav.kanban",
  folios: "campaign.settings.nav.folios",
  chapters: "campaign.settings.nav.chapters",
  sigils: "campaign.settings.nav.sigils",
  outposts: "campaign.settings.nav.outposts",
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
            aria-label={tr("campaign.settings.feature.enable")}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignSettingsFeatureSection;

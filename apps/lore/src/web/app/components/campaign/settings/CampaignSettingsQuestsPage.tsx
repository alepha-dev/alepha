import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { CampaignFeatures } from "@/api/entities/campaigns.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

type QuestFeatureKey = "questNote" | "questReminder" | "questChrono";

/**
 * Compile-time guard — if a key gets renamed in the entity the
 * `satisfies` check forces this file to update.
 */
type _Check = QuestFeatureKey extends keyof CampaignFeatures ? true : never;
const _questFeatureKeyCheck: _Check = true;
void _questFeatureKeyCheck;

export interface QuestFeatureRow {
  key: QuestFeatureKey;
  labelKey:
    | "campaign.settings.quests.note.label"
    | "campaign.settings.quests.reminder.label"
    | "campaign.settings.quests.chrono.label";
  descriptionKey:
    | "campaign.settings.quests.note.description"
    | "campaign.settings.quests.reminder.description"
    | "campaign.settings.quests.chrono.description";
}

const ROWS: QuestFeatureRow[] = [
  {
    key: "questNote",
    labelKey: "campaign.settings.quests.note.label",
    descriptionKey: "campaign.settings.quests.note.description",
  },
  {
    key: "questChrono",
    labelKey: "campaign.settings.quests.chrono.label",
    descriptionKey: "campaign.settings.quests.chrono.description",
  },
  {
    key: "questReminder",
    labelKey: "campaign.settings.quests.reminder.label",
    descriptionKey: "campaign.settings.quests.reminder.description",
  },
];

const CampaignSettingsQuestsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {tr("campaign.settings.quests.title")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("campaign.settings.quests.subtitle")}
        </span>
      </div>

      <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
        {ROWS.map((row) => (
          <CampaignSettingsQuestsPageRow key={row.key} row={row} />
        ))}
      </Card>
    </div>
  );
};

export interface CampaignSettingsQuestsPageRowProps {
  row: QuestFeatureRow;
}

const CampaignSettingsQuestsPageRow = (
  props: CampaignSettingsQuestsPageRowProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const { enabled, toggle } = useCampaignFeatureToggle(props.row.key);

  return (
    <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {tr(props.row.labelKey)}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr(props.row.descriptionKey)}
        </span>
      </div>
      <div className="flex justify-start sm:justify-end">
        <Switch
          checked={enabled}
          onCheckedChange={(value) => {
            void toggle(value);
          }}
          aria-label={tr(props.row.labelKey)}
        />
      </div>
    </CardContent>
  );
};

export default CampaignSettingsQuestsPage;

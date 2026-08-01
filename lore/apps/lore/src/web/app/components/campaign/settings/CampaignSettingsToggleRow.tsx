import { CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import type { FeatureToggle } from "./useCampaignFeatureToggle.ts";

export interface CampaignSettingsToggleRowProps {
  title: string;
  description: string;
  toggle: FeatureToggle;
}

/**
 * One switch inside a settings card.
 *
 * Takes already-translated strings rather than i18n keys: the key literals have
 * to stay visible at the call site or the catalog audit cannot see them.
 */
const CampaignSettingsToggleRow = (props: CampaignSettingsToggleRowProps) => {
  return (
    <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{props.title}</span>
        <span className="text-muted-foreground text-xs">
          {props.description}
        </span>
      </div>
      <div className="flex justify-start sm:justify-end">
        <Switch
          checked={props.toggle.enabled}
          onCheckedChange={(value) => void props.toggle.toggle(value === true)}
          aria-label={props.title}
        />
      </div>
    </CardContent>
  );
};

export default CampaignSettingsToggleRow;

import {
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui/components/ui/tooltip";
import { useI18n } from "alepha/react/i18n";
import { Info } from "lucide-react";
import type { I18n } from "../../../services/I18n.ts";

export interface AppAnalyticsEstimatedBadgeProps {
  /**
   * Whether the figures this badge sits above were reconstructed from a
   * sample rather than measured directly (`InsightsResource.estimated`).
   */
  estimated: boolean;
  /**
   * The largest sample interval behind those figures
   * (`InsightsResource.sampleInterval`). `1` means Analytics Engine did not
   * actually sample, so the numbers are exact even though `estimated` is
   * true.
   */
  sampleInterval?: number;
}

/**
 * A small "Estimated" qualifier with a tooltip, shown above analytics and
 * performance figures that were reconstructed from a sample instead of
 * measured directly — so the UI stops rendering estimates in the typography
 * of measurement.
 *
 * Renders nothing unless both halves hold: `estimated` is true AND
 * `sampleInterval !== 1`. Analytics Engine does not sample at low traffic,
 * so `sampleInterval === 1` means the numbers are exact despite `estimated`
 * being true — labelling exact numbers as estimates would be its own kind of
 * wrong. On Lore's relational backend `estimated` is always false today, so
 * this renders nothing until a Cloudflare deployment starts sampling.
 */
const AppAnalyticsEstimatedBadge = (props: AppAnalyticsEstimatedBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();

  if (!props.estimated || props.sampleInterval === 1) {
    return null;
  }

  return (
    <UiTooltip>
      <TooltipTrigger className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
        <Info className="size-3" />
        {tr("insights.estimated")}
      </TooltipTrigger>
      <TooltipContent>{tr("insights.estimated.note")}</TooltipContent>
    </UiTooltip>
  );
};

export default AppAnalyticsEstimatedBadge;

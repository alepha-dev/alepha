import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Check, Dices } from "lucide-react";

export interface SamplingBadgeProps {
  estimated: boolean;
  sampleInterval?: number;
}

/**
 * Whether the numbers beside it were measured or reconstructed.
 *
 * It sits above the total cards, deliberately: a figure in 28px type is the
 * one someone screenshots into a decision, so "estimated, sampled ×4" belongs
 * next to it rather than buried by the table, which people already read
 * carefully.
 *
 * `estimated` with an interval of 1 is the common low-traffic case on a
 * sampling backend: the backend could have sampled and did not, so the
 * numbers are exact and the qualifier would be a lie in the other direction.
 */
export const SamplingBadge = (props: SamplingBadgeProps) => {
  const { tr } = useI18n();
  const interval = props.sampleInterval ?? 1;
  const sampled = props.estimated && interval > 1;

  return (
    <Badge
      variant="tint"
      tone={sampled ? "warning" : "success"}
      className="h-[22px] gap-1.5 px-2.5 text-[11px]"
    >
      {sampled ? (
        <Dices className="size-[11px]" />
      ) : (
        <Check className="size-[11px]" />
      )}
      {sampled
        ? tr("admin.analytics.samplingEstimated", {
            default: "Estimated, sampled ×$1",
            args: [String(interval)],
          })
        : tr("admin.analytics.samplingExact", { default: "Exact, unsampled" })}
    </Badge>
  );
};

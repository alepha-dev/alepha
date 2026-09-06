import { formatBytes } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface BayUsageBarProps {
  label: string;
  /**
   * Absent when the host could not read it. Absent is NOT zero: `Gauge.Sample`
   * degrades an unreadable `/proc` file to a missing field on purpose, and a
   * bar drawn at 0% for a disk nobody measured is a claim about the machine.
   */
  usedBytes?: number;
  totalBytes?: number;
}

/**
 * One host resource as a figure with a bar: "5.2 GB of 8 GB".
 *
 * The figure is the point and the bar is the shape. A percentage alone is a
 * fine list badge and a useless console reading, which is half the reason this
 * epic exists: an operator acts on "600 MB free", not on "92%".
 */
const BayUsageBar = (props: BayUsageBarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { usedBytes, totalBytes } = props;
  const known =
    usedBytes !== undefined && totalBytes !== undefined && totalBytes > 0;
  const share = known ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-xs">{props.label}</span>
        <span className="text-sm font-medium tabular-nums">
          {known
            ? tr("bay.overview.usedOf", {
                args: [formatBytes(usedBytes), formatBytes(totalBytes)],
              })
            : tr("bay.overview.notReported")}
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        {known && (
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${share}%` }}
            role="presentation"
          />
        )}
      </div>
    </div>
  );
};

export default BayUsageBar;

import { type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorCheckBucket } from "../../../../../api/schemas/monitorCheckBucketSchema.ts";

export interface MonitorPeriodBarProps {
  buckets: MonitorCheckBucket[];
}

/**
 * The Uptime page's check bar over the selected window (#Q4009): one slice
 * per bucket the server aggregated, red when any check in it failed, green
 * when every one passed, empty when none ran. Each slice says its range, its
 * checks and its failures on hover.
 *
 * The compact strip of the tables is `MonitorBeatBar`, still the last checks.
 */
const MonitorPeriodBar = (props: MonitorPeriodBarProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  return (
    <div
      className="flex h-7 min-w-28 items-stretch gap-0.5"
      aria-label={tr("uptime.checksBar")}
      data-testid="monitor-period-bar"
    >
      {props.buckets.map((bucket) => {
        const state =
          bucket.checks === 0 ? "none" : bucket.failures > 0 ? "down" : "up";
        return (
          <span
            key={bucket.from}
            data-state={state}
            className={`min-w-0.5 flex-1 rounded-sm ${
              state === "none"
                ? "bg-muted"
                : state === "down"
                  ? "bg-red-500/80"
                  : "bg-emerald-500/80"
            }`}
            title={tr("uptime.bucketTitle", {
              args: [
                l(bucket.from, { date: "lll" }),
                l(bucket.to, { date: "lll" }),
                l(bucket.checks),
                l(bucket.failures),
              ],
            })}
          />
        );
      })}
    </div>
  );
};

export default MonitorPeriodBar;

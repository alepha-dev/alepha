import { type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorHeartbeatResource } from "../../../../../api/schemas/monitorHeartbeatResourceSchema.ts";

export interface MonitorBeatBarProps {
  beats: MonitorHeartbeatResource[];
}
const MonitorBeatBar = (props: MonitorBeatBarProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  return (
    <div
      className="flex h-7 min-w-28 items-stretch gap-0.5"
      aria-label={tr("uptime.recentChecks")}
    >
      {props.beats.length ? (
        props.beats.slice(-50).map((beat) => (
          <span
            key={beat.id}
            className={`min-w-1 flex-1 rounded-sm ${beat.ok ? "bg-emerald-500/80" : "bg-red-500/80"}`}
            title={tr("uptime.beatTitle", {
              args: [
                l(beat.at, { date: "lll" }),
                l(beat.latencyMs),
                tr(beat.ok ? "uptime.status.up" : "uptime.status.down"),
              ],
            })}
          />
        ))
      ) : (
        <span className="text-muted-foreground text-xs">
          {tr("uptime.notMeasured")}
        </span>
      )}
    </div>
  );
};
export default MonitorBeatBar;

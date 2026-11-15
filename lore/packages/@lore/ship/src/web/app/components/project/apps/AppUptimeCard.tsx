import { Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";
import MonitorBeatBar from "../uptime/MonitorBeatBar.tsx";

export interface AppUptimeCardProps {
  /**
   * The copy's monitor, while Monitor is on in its settings (#Q3684).
   */
  monitor: MonitorListItem;
  /**
   * Where the monitor's own page is.
   */
  href?: string;
}

/**
 * The app page's view of uptime: this instance's monitor, or the one action
 * that creates it (#Q2680). Under its name, the strip of recent checks the
 * Apps list draws (#Q3694), the same component at full width, so an outage
 * shows at a glance.
 */
const AppUptimeCard = (props: AppUptimeCardProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const monitor = props.monitor;

  const status =
    monitor.status === "up" && monitor.lastResult === "latency"
      ? "latency"
      : monitor.status;

  return (
    <Card data-testid="app-uptime">
      <CardHeader>
        <CardTitle className="text-base">{tr("uptime.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">
            {props.href ? (
              <a className="hover:underline" href={props.href}>
                {monitor.name}
              </a>
            ) : (
              monitor.name
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            {tr("uptime.uptime")}:{" "}
            {monitor.uptimePct === null
              ? tr("uptime.notMeasured")
              : l(monitor.uptimePct / 100, {
                  number: { style: "percent", maximumFractionDigits: 2 },
                })}
          </div>
        </div>
        <span className="bg-muted rounded-full px-2 py-1 text-xs font-medium">
          {tr(`uptime.status.${status}`)}
        </span>
        <div className="basis-full" data-testid="app-uptime-beats">
          <MonitorBeatBar beats={monitor.beats} />
        </div>
      </CardContent>
    </Card>
  );
};

export default AppUptimeCard;

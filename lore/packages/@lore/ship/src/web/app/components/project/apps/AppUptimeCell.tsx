import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Skeleton,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";
import MonitorBeatBar from "../uptime/MonitorBeatBar.tsx";

export interface AppUptimeCellProps {
  /**
   * The instance's monitor, from the 24-hour list the table already loaded.
   */
  monitor: MonitorListItem;
}

/**
 * The Apps table's Uptime cell (#Q3598): a compact beat bar of the recent
 * checks beside the 24-hour percentage, and a hover card with the window, the
 * current state and since when, the last latency and the last incident.
 *
 * The bar and the percentage come from the list the table loads after its
 * first paint. The last incident is not in that list, so the card reads the
 * monitor's detail when it opens, under the key the monitor page uses: a
 * table of thirty apps costs nothing until somebody hovers one.
 */
const AppUptimeCell = (props: AppUptimeCellProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<MonitorController>();
  const [open, setOpen] = useState(false);
  const monitor = props.monitor;
  const detail = useQuery(
    {
      enabled: open,
      key: ["uptime-monitor", monitor.id, "24h"],
      handler: ({ signal }) =>
        api.getMonitorDetail(
          { params: { monitorId: monitor.id }, query: { window: "24h" } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [api, monitor.id, open],
  );
  const percent =
    monitor.uptimePct === null
      ? tr("uptime.notMeasured")
      : l(monitor.uptimePct / 100, {
          number: { style: "percent", maximumFractionDigits: 2 },
        });
  const status = !monitor.active
    ? "paused"
    : monitor.status === "up" && monitor.lastResult === "latency"
      ? "latency"
      : monitor.status;
  const incident = detail.data?.incidents[0];

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        render={
          <span
            className="ms-auto inline-flex items-center gap-2 text-xs whitespace-nowrap tabular-nums"
            data-testid="apps-uptime-cell"
          >
            <MonitorBeatBar beats={monitor.beats} compact />
            {percent}
          </span>
        }
      />
      <HoverCardContent className="w-64 p-3 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground">{tr("uptime.windowLabel")}</dt>
          <dd>{tr("uptime.window.24h")}</dd>
          <dt className="text-muted-foreground">{tr("uptime.uptime")}</dt>
          <dd className="tabular-nums">{percent}</dd>
          <dt className="text-muted-foreground">{tr("uptime.cell.state")}</dt>
          <dd>
            {tr(`uptime.status.${status}`)}
            <span className="text-muted-foreground block">
              {tr("uptime.since", {
                args: [l(monitor.statusSince, { date: "lll" })],
              })}
            </span>
          </dd>
          <dt className="text-muted-foreground">{tr("uptime.lastLatency")}</dt>
          <dd className="tabular-nums">
            {monitor.lastLatencyMs === undefined
              ? tr("uptime.notMeasured")
              : tr("uptime.latencyValue", {
                  args: [l(monitor.lastLatencyMs)],
                })}
          </dd>
          <dt className="text-muted-foreground">
            {tr("uptime.cell.lastIncident")}
          </dt>
          <dd data-testid="apps-uptime-last-incident">
            {!detail.data ? (
              <Skeleton className="h-4 w-24" />
            ) : incident ? (
              <>
                {l(incident.startedAt, { date: "lll" })}
                <span className="text-muted-foreground block">
                  {incident.endedAt
                    ? tr("uptime.duration", {
                        args: [l(Math.round(incident.durationSecs))],
                      })
                    : tr("uptime.ongoing")}
                  {`: ${incident.cause}`}
                </span>
              </>
            ) : (
              tr("uptime.cell.noIncident")
            )}
          </dd>
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
};

export default AppUptimeCell;

import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorDetailResource } from "../../../../../api/schemas/monitorDetailResourceSchema.ts";
import MonitorBeatBar from "./MonitorBeatBar.tsx";
import MonitorLatencyChart from "./MonitorLatencyChart.tsx";
export interface MonitorDetailBodyProps {
  data: MonitorDetailResource;
}
const MonitorDetailBody = (props: MonitorDetailBodyProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const data = props.data;
  const monitor = data.monitor;
  const status =
    monitor.status === "up" && monitor.lastResult === "latency"
      ? "latency"
      : monitor.status;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{monitor.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm break-all">
          {tr(`uptime.kind.${monitor.kind}` as never)}
          {monitor.target ? `: ${monitor.target}` : ""}
        </p>
        <p className="mt-3 font-medium">
          {tr(`uptime.status.${status}` as never)}{" "}
          <span className="text-muted-foreground text-sm font-normal">
            {tr("uptime.since", {
              args: [l(monitor.statusSince, { date: "lll" })],
            })}
          </span>
        </p>
        {monitor.lastError && (
          <p className="text-danger-text mt-2 text-sm break-words">
            {monitor.lastError}
          </p>
        )}
        {monitor.certExpiresAt && (
          <p className="mt-2 text-sm">
            {tr("uptime.certExpiry", {
              args: [l(monitor.certExpiresAt, { date: "lll" })],
            })}
          </p>
        )}
      </header>
      <div className="bg-card rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium">
          {tr("uptime.recentChecks")}
        </h2>
        <MonitorBeatBar beats={data.beats} />
      </div>
      {data.estimated && (
        <p className="text-muted-foreground text-sm">
          {tr("uptime.estimated")}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {data.uptime.map((card) => (
          <div key={card.window} className="bg-card rounded-lg border p-4">
            <h2 className="text-muted-foreground text-sm">
              {tr(`uptime.window.${card.window}` as never)}
            </h2>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {card.uptimePct === null
                ? tr("uptime.notMeasured")
                : l(card.uptimePct / 100, {
                    number: { style: "percent", maximumFractionDigits: 2 },
                  })}
            </p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{tr("uptime.bucketNote")}</p>
      <div className="bg-card rounded-lg border p-4">
        <MonitorLatencyChart points={data.points} />
      </div>
      <section className="bg-card rounded-lg border p-4">
        <h2 className="font-semibold">{tr("uptime.incidents")}</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          {tr("uptime.incidentLimit")}
        </p>
        {data.incidents.length ? (
          <ol className="divide-y">
            {data.incidents.map((incident) => (
              <li key={incident.id} className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{l(incident.startedAt, { date: "lll" })}</span>
                  <span>
                    {incident.endedAt
                      ? l(incident.endedAt, { date: "lll" })
                      : tr("uptime.ongoing")}
                  </span>
                </div>
                <p className="mt-1 font-medium">
                  {tr("uptime.duration", {
                    args: [l(Math.round(incident.durationSecs))],
                  })}
                  : {incident.cause}
                </p>
                {incident.lastError && (
                  <p className="text-muted-foreground mt-1 break-words">
                    {incident.lastError}
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground py-4 text-sm">
            {tr("uptime.noIncidents")}
          </p>
        )}
      </section>
    </div>
  );
};
export default MonitorDetailBody;

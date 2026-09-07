import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

import BayStatsChart from "./BayStatsChart.tsx";
import BayUsageBar from "./BayUsageBar.tsx";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * What the machine is, and what it costs.
 *
 * ⚠️ **Liveness and freshness are two different claims**, and the page states
 * them separately. A machine can be connected while its last inventory is
 * half an hour old, and a console that conflates the two lies during exactly
 * the outage it exists for. "Online" comes from the estate row's stamps;
 * "reported N ago" comes from the inventory's `reportedAt`, Lore's clock.
 *
 * ⚠️ **The CPU figure is the estate row's gauge, never the series.** Every
 * measure in `estate_stats` comes back as a sample-corrected sum, and "CPU
 * right now" is not a sum.
 *
 * ⚠️ **Three legitimately empty states**, each with its own sentence, because
 * a zero in any of them prints a lie: never connected, connected with nothing
 * reported yet, and a field the host could not read (the gauge degrades a
 * missing `/proc` file to an absent field on purpose, so disk can be absent
 * while memory is present).
 */
const BayOverview = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const { estate, data } = useBayInventory();

  if (!estate) {
    return null;
  }
  const inventory = data?.inventory ?? undefined;
  const host = inventory?.host;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {tr("bay.overview.title")}
            </h2>
            {/* Said separately from "online" on purpose: see the class doc. */}
            <span className="text-muted-foreground text-xs">
              {inventory
                ? tr("bay.overview.reported", {
                    args: [
                      String(l(inventory.reportedAt, { date: "fromNow" })),
                    ],
                  })
                : estate.connectedAt
                  ? tr("bay.overview.noReportYet")
                  : tr("bay.overview.neverConnected")}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <BayUsageBar
              label={String(tr("bay.overview.memory"))}
              usedBytes={host?.memUsedBytes}
              totalBytes={host?.memTotalBytes}
            />
            <BayUsageBar
              label={String(tr("bay.overview.disk"))}
              usedBytes={host?.diskUsedBytes}
              totalBytes={host?.diskTotalBytes}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Fact
              label={String(tr("bay.overview.cpu"))}
              // The row's live gauge, always written on a stats push, and
              // exact. Absent until the first push lands.
              value={
                estate.cpuPercent === undefined
                  ? undefined
                  : `${Math.round(estate.cpuPercent)}%`
              }
              empty={String(tr("bay.overview.notReported"))}
            />
            <Fact
              label={String(tr("bay.overview.cores"))}
              value={host?.cores === undefined ? undefined : String(host.cores)}
              empty={String(tr("bay.overview.notReported"))}
            />
            <Fact
              label={String(tr("bay.overview.load"))}
              value={host?.load1 === undefined ? undefined : String(host.load1)}
              empty={String(tr("bay.overview.notReported"))}
            />
            <Fact
              label={String(tr("bay.overview.uptime"))}
              value={
                host?.uptimeSeconds === undefined
                  ? undefined
                  : String(
                      l(
                        dt
                          .of(dt.nowISOString())
                          .subtract(host.uptimeSeconds, "seconds")
                          .toISOString(),
                        { date: "fromNow" },
                      ),
                    )
              }
              empty={String(tr("bay.overview.notReported"))}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            {tr("bay.overview.connection")}
          </h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Fact
              label={String(tr("bay.overview.state"))}
              value={String(
                estate.online ? tr("estates.online") : tr("estates.offline"),
              )}
              empty=""
            />
            <Fact
              label={String(tr("bay.overview.lastSeen"))}
              value={
                estate.lastSeenAt
                  ? String(l(estate.lastSeenAt, { date: "lll" }))
                  : undefined
              }
              empty={String(tr("estates.neverSeen"))}
            />
            <Fact
              label={String(tr("bay.overview.connectedSince"))}
              value={
                estate.connectedAt
                  ? String(l(estate.connectedAt, { date: "lll" }))
                  : undefined
              }
              empty={String(tr("estates.neverSeen"))}
            />
            <Fact
              label={String(tr("bay.overview.interval"))}
              value={String(
                tr("bay.overview.intervalValue", {
                  args: [String(estate.statsIntervalSeconds)],
                }),
              )}
              empty=""
            />
          </dl>
          <p className="text-muted-foreground text-xs">
            {inventory?.bayVersion
              ? tr("bay.overview.version", { args: [inventory.bayVersion] })
              : tr("bay.overview.versionUnknown")}
          </p>
        </CardContent>
      </Card>

      <BayStatsChart />
    </div>
  );
};

export default BayOverview;

interface FactProps {
  label: string;
  /**
   * Absent means the machine did not report it, which is a different fact
   * from a value of zero and is rendered as `empty` rather than as a number.
   */
  value?: string;
  empty: string;
}

const Fact = (props: FactProps) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground text-xs">{props.label}</dt>
    <dd
      className={
        props.value ? "font-medium tabular-nums" : "text-muted-foreground"
      }
    >
      {props.value ?? props.empty}
    </dd>
  </div>
);

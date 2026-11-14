import { Card, CardContent } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { HostCost } from "../../../../api/schemas/HostCost.ts";
import BayStacks from "./BayStacks.tsx";
import BayStatsChart from "./BayStatsChart.client.tsx";
import BayUsageBar from "./BayUsageBar.tsx";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * What the machine is, and what it costs.
 *
 * ⚠️ **Liveness and freshness are two different claims**, and the page states
 * them separately. A machine can be connected while its last inventory is
 * half an hour old, and a console that conflates the two lies during exactly
 * the outage it exists for. "Online" comes from the host row's stamps;
 * "reported N ago" comes from the inventory's `reportedAt`, Lore's clock.
 *
 * ⚠️ **The CPU figure is the host row's gauge, never the series.** Every
 * measure in `host_stats` comes back as a sample-corrected sum, and "CPU
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
  const { host, data } = useBayInventory();

  if (!host) {
    return null;
  }
  const inventory = data?.inventory ?? undefined;
  const machine = inventory?.machine;
  const spent = HostCost.soFar(host, dt.nowMillis());

  return (
    <AccountPage variant="form" className="max-w-5xl gap-4">
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
                    args: [l(inventory.reportedAt, { date: "fromNow" })],
                  })
                : host.connectedAt
                  ? tr("bay.overview.noReportYet")
                  : tr("bay.overview.neverConnected")}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <BayUsageBar
              label={tr("bay.overview.memory")}
              usedBytes={machine?.memUsedBytes}
              totalBytes={machine?.memTotalBytes}
            />
            <BayUsageBar
              label={tr("bay.overview.disk")}
              usedBytes={machine?.diskUsedBytes}
              totalBytes={machine?.diskTotalBytes}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Fact
              label={tr("bay.overview.cpu")}
              // The row's live gauge, always written on a stats push, and
              // exact. Absent until the first push lands.
              value={
                host.cpuPercent === undefined
                  ? undefined
                  : `${Math.round(host.cpuPercent)}%`
              }
              empty={tr("bay.overview.notReported")}
            />
            <Fact
              label={tr("bay.overview.cores")}
              value={
                machine?.cores === undefined ? undefined : String(machine.cores)
              }
              empty={tr("bay.overview.notReported")}
            />
            <Fact
              label={tr("bay.overview.load")}
              value={
                machine?.load1 === undefined ? undefined : String(machine.load1)
              }
              empty={tr("bay.overview.notReported")}
            />
            <Fact
              label={tr("bay.overview.uptime")}
              value={
                machine?.uptimeSeconds === undefined
                  ? undefined
                  : l(
                      dt
                        .of(dt.nowISOString())
                        .subtract(machine.uptimeSeconds, "seconds")
                        .toISOString(),
                      { date: "fromNow" },
                    )
              }
              empty={tr("bay.overview.notReported")}
            />
          </dl>
        </CardContent>
      </Card>

      {inventory?.stacks?.length ? (
        <BayStacks stacks={inventory.stacks} />
      ) : null}

      {host.providerServerId ? (
        // A server lore host provision bought (#Q3168): what it is and
        // what it has cost, so a forgotten one is visible.
        <Card data-testid="bay-overview-server">
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {tr("bay.overview.server")}
            </h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Fact
                label={tr("bay.overview.provider")}
                value={host.provider}
                empty=""
              />
              <Fact
                label={tr("bay.overview.serverId")}
                value={host.providerServerId}
                empty=""
              />
              <Fact
                label={tr("bay.overview.serverType")}
                value={[host.providerServerType, host.providerZone]
                  .filter(Boolean)
                  .join(", ")}
                empty=""
              />
              <Fact
                label={tr("bay.overview.hourlyPrice")}
                value={
                  host.hourlyPrice === undefined
                    ? undefined
                    : tr("bay.overview.hourlyPriceValue", {
                        args: [host.hourlyPrice.toFixed(4)],
                      })
                }
                empty={tr("bay.overview.notReported")}
              />
              <Fact
                label={tr("bay.overview.costSoFar")}
                value={
                  spent === undefined
                    ? undefined
                    : tr("bay.overview.costSoFarValue", {
                        args: [spent.toFixed(2)],
                      })
                }
                empty={tr("bay.overview.notReported")}
              />
            </dl>
            <p className="text-muted-foreground text-xs">
              {tr("bay.overview.serverNote", {
                args: [host.provider ?? "", host.slug],
              })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            {tr("bay.overview.connection")}
          </h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Fact
              label={tr("bay.overview.state")}
              value={String(
                host.online ? tr("hosts.online") : tr("hosts.offline"),
              )}
              empty=""
            />
            <Fact
              label={tr("bay.overview.lastSeen")}
              value={
                host.lastSeenAt
                  ? l(host.lastSeenAt, { date: "lll" })
                  : undefined
              }
              empty={tr("hosts.neverSeen")}
            />
            <Fact
              label={tr("bay.overview.connectedSince")}
              value={
                host.connectedAt
                  ? l(host.connectedAt, { date: "lll" })
                  : undefined
              }
              empty={tr("hosts.neverSeen")}
            />
            <Fact
              label={tr("bay.overview.interval")}
              value={tr("bay.overview.intervalValue", {
                args: [String(host.statsIntervalSeconds)],
              })}
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
    </AccountPage>
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

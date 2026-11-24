import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { hostInventories } from "../entities/hostInventories.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import { BayUpgrade } from "../schemas/BayUpgrade.ts";
import type { HostInventoryFrame } from "../schemas/hostInventoryFrameSchema.ts";
import type {
  HostInventoryExpectedApp,
  HostInventoryProject,
  HostInventoryReportedApp,
  HostInventoryResource,
} from "../schemas/hostInventoryResourceSchema.ts";
import type { HostInventorySummary } from "../schemas/ownedHostResourceSchema.ts";
import { BayReleaseTarget } from "./BayReleaseTarget.ts";
import { HostUsageRegistry } from "./HostUsageRegistry.ts";

/**
 * What Lore does with an inventory push: one row per host, updated in
 * place.
 *
 * The split is the one `HostStatsService` already draws. The websocket
 * endpoint owns the connection and stamps `lastSeenAt` itself, then hands
 * the validated frame here; the endpoint knows sockets and this knows what a
 * snapshot is, and the two facts do not belong in one file.
 *
 * ⚠️ Nothing here appends. A machine pushes on connect, on its tick and
 * after every command that changes state, so an append-only table would grow
 * without bound for a page that only ever shows the latest row. The upsert
 * is what keeps a push to one write whatever the app count.
 *
 * `reportedAt` is Lore's clock and `at` is the machine's, kept as a claim. A
 * host whose clock is hours off would otherwise show "measured 3 hours ago"
 * beside a `lastSeenAt` of a second ago.
 */
export class HostInventoryService {
  protected readonly log = $logger();
  protected readonly inventories = $repository(hostInventories);
  protected readonly hosts = $repository(hosts);
  protected readonly usage = $inject(HostUsageRegistry);
  protected readonly projects = $repository(projects);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly target = $inject(BayReleaseTarget);

  /**
   * Store what the machine reported, replacing whatever it said before.
   *
   * Read-then-write rather than a database upsert, because D1 has no
   * `ON CONFLICT DO UPDATE` through this repository and the alternative is a
   * unique-constraint failure that would drop the frame. Two pushes racing
   * would both write the same host's row; the loser's is superseded, which
   * is what a snapshot means.
   */
  async record(host: Host, frame: HostInventoryFrame): Promise<void> {
    const row = {
      at: frame.at,
      reportedAt: this.now(),
      // The frame's `host` block is Bay wire v1 and keeps its name; Lore
      // stores it as `machine`.
      machine: frame.host,
      apps: frame.apps,
      appCount: frame.apps.length,
      stacks: frame.stacks ?? [],
      ...(frame.host.bayVersion === undefined
        ? {}
        : { bayVersion: frame.host.bayVersion }),
    };

    // What its jobs user has (#Q4220), which the agent gate reads.
    const tools = frame.jobs?.tools ?? null;
    if (JSON.stringify(host.jobsTools ?? null) !== JSON.stringify(tools)) {
      await this.hosts.updateById(host.id, { jobsTools: tools });
    }
    // Whether its Bay prepares a job's source (#E173), which the gate on
    // read and write jobs reads.
    const sources = frame.jobs?.sources === true;
    // Whether its terminal acks carry an agent's reply (#Q4288).
    const result = frame.jobs?.result === true;
    // How many jobs it runs at once, and runs now (#Q4249).
    const maxJobs = frame.jobs?.maxJobs ?? null;
    const running = frame.jobs
      ? (frame.jobs.running ?? "").split(",").filter(Boolean).length
      : null;
    // Its jobs user (#Q4254): empty when it reported none, so the page
    // tells "no jobs user" from "never reported".
    const user = frame.jobs?.user ?? "";
    if (
      (host.jobsSources ?? false) !== sources ||
      (host.jobsResult ?? false) !== result ||
      (host.jobsMaxJobs ?? null) !== maxJobs ||
      (host.jobsRunning ?? null) !== running ||
      host.jobsUser !== user
    ) {
      await this.hosts.updateById(host.id, {
        jobsSources: sources,
        jobsResult: result,
        jobsMaxJobs: maxJobs,
        jobsRunning: running,
        jobsUser: user,
      });
    }

    const existing = await this.findFor(host.id);
    if (existing) {
      await this.inventories.updateById(existing.id, row);
      return;
    }
    await this.inventories.create({ hostId: host.id, ...row });
  }

  /**
   * The stored snapshot, or nothing for a machine that has never reported.
   *
   * Absent is a real state the console renders ("nothing reported yet"), so
   * it is answered as `undefined` rather than as an empty inventory: a host
   * with no apps and a host that never spoke are two different sentences.
   */
  async findFor(hostId: string) {
    return this.inventories.findOne({ where: { hostId: { eq: hostId } } });
  }

  /**
   * What the machine reported, held against what Lore tracks.
   *
   * Three states fall out of matching the `(app, env)` pair against the
   * `app_instances` rows pointing at this host, and the third is the one
   * that earns the whole method: an instance Lore expects here that the
   * machine did not report is a deploy that failed, and nothing else in the
   * product notices it.
   *
   * Done here rather than in the page for two reasons. A spec proves all
   * three states without a browser. And the deferred "share a read-only view
   * with a project this host is lent to" is this method with a `projectId`
   * filter, which is a query rather than a migration - which is what storing
   * the snapshot bought in the first place.
   *
   * Projects are resolved in ONE `inArray` query, the `withLoans` shape,
   * never one per row.
   */
  async reconcile(host: Host): Promise<HostInventoryResource> {
    const [stored, tracked] = await Promise.all([
      this.findFor(host.id),
      // The copies Lore expects here, from whichever module deploys
      // (Ship), through core's registry (#E166).
      this.usage.trackedApps(host.id),
    ]);

    const named = await this.projectsOf(tracked.map((row) => row.projectId));
    const byPair = new Map(
      tracked.map((row) => [this.pair(row.app, row.env), row]),
    );

    const reported: HostInventoryReportedApp[] = (stored?.apps ?? []).map(
      (app) => {
        const match = byPair.get(this.pair(app.app, app.env));
        if (!match) {
          // Running on the machine, tracked nowhere in Lore. Shown rather
          // than hidden: it is a real thing serving real traffic.
          return { ...app, tracking: "untracked" as const };
        }
        const project = named.get(match.projectId);
        return {
          ...app,
          tracking: "matched" as const,
          instanceId: match.id,
          ...(project ? { project } : {}),
        };
      },
    );

    const seen = new Set(
      (stored?.apps ?? []).map((app) => this.pair(app.app, app.env)),
    );
    const expected: HostInventoryExpectedApp[] = tracked
      .filter((row) => !seen.has(this.pair(row.app, row.env)))
      .map((row) => {
        const project = named.get(row.projectId);
        return {
          app: row.app,
          env: row.env,
          instanceId: row.id,
          tracking: "missing" as const,
          ...(project ? { project } : {}),
        };
      });

    const target = this.target.version();
    const upgradeMode = stored?.machine.upgradeMode;
    return {
      inventory: stored
        ? {
            at: stored.at,
            reportedAt: stored.reportedAt,
            ...(stored.bayVersion === undefined
              ? {}
              : { bayVersion: stored.bayVersion }),
            ...(upgradeMode === undefined ? {} : { upgradeMode }),
            ...(target === undefined ? {} : { targetBayVersion: target }),
            ...BayUpgrade.status({
              bayVersion: stored.bayVersion,
              upgradeMode,
              target,
            }),
            machine: stored.machine,
            apps: reported,
            ...(stored.stacks?.length ? { stacks: stored.stacks } : {}),
          }
        : null,
      expected,
    };
  }

  /**
   * The summary for a list of hosts, keyed by host id.
   *
   * One query for the whole list, so an hosts list can say "7 apps,
   * reported 4 minutes ago, Bay 0.39.0" per row without a read per row and
   * without parsing a single app array. Whether a host can TAKE the upgrade
   * is not here: the mode lives in the machine block, and the list only says
   * that one is due.
   */
  async summariesFor(
    hostIds: string[],
  ): Promise<Map<string, HostInventorySummary>> {
    if (hostIds.length === 0) {
      return new Map();
    }
    const rows = await this.inventories.findMany({
      where: { hostId: { inArray: hostIds } },
      columns: ["hostId", "appCount", "reportedAt", "bayVersion"],
    });
    const target = this.target.version();
    return new Map(
      rows.map((row) => {
        const { upgradeAvailable } = BayUpgrade.status({
          bayVersion: row.bayVersion,
          upgradeMode: "handoff",
          target,
        });
        return [
          row.hostId,
          {
            appCount: row.appCount,
            reportedAt: row.reportedAt,
            ...(row.bayVersion === undefined
              ? {}
              : { bayVersion: row.bayVersion }),
            upgradeAvailable,
            ...(upgradeAvailable && target ? { targetBayVersion: target } : {}),
          },
        ];
      }),
    );
  }

  /**
   * The instance key both sides agree on. The machine reports `(app, env)`
   * and knows nothing about projects, so the pair is the only thing there is
   * to match on.
   */
  protected pair(app: string, env: string): string {
    return `${app}/${env}`;
  }

  protected async projectsOf(
    projectIds: number[],
  ): Promise<Map<number, HostInventoryProject>> {
    const unique = [...new Set(projectIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.projects.findMany({
      where: { id: { inArray: unique } },
      columns: ["id", "title", "slug"],
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title,
          ...(row.slug ? { slug: row.slug } : {}),
        },
      ]),
    );
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}

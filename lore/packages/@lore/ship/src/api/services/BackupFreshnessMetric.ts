import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
  HostInventoryService,
} from "@lore/core/api";
import {
  BACKUP_STATE_RISK,
  type DashboardCardValue,
  DashboardMetricCatalog,
  type HostInventoryApp,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { BayRemovalService } from "./BayRemovalService.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;
type Row = NonNullable<DashboardCardValue["rows"]>[number];
type BackupFreshnessState =
  | "restore-pending"
  | "failing"
  | "stale"
  | "never"
  | "ok"
  | "unknown";

/**
 * `backupFreshness` (#Q4523): how old each copy's last Bay snapshot is, and
 * whether the last attempt failed. One row per copy in scope that its Bay
 * backs up, worst first.
 *
 * - **What Bay reports, not a second opinion**: the machine's inventory
 *   carries each instance's backup state (`hostInventoryBackupSchema`),
 *   which Bay decides against the copy's own schedule. A copy backed up
 *   daily is stale after a day and a half, one backed up weekly is not, so
 *   no threshold here could agree with both. A Bay older than its backup
 *   policies reports only the flat fields, read the same way.
 * - **The tone**: `bad` when the last attempt failed or a restore is
 *   pending, `warn` when stale or never backed up yet, `ok` when fresh, and
 *   `neutral` for a state a later Bay adds, which is never read as fresh.
 * - **The age is the row's time**: `at` is the last snapshot's stamp, which
 *   the tile renders relative. The title is its stored size.
 * - **A copy not backed up is not a row**: a copy with backups off, on a
 *   host that is not a Bay or that has not reported, has nothing to say
 *   about freshness. Empty (`noBackup`) when no copy in scope is backed up.
 */
export class BackupFreshnessMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "backupFreshness";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly instances = $repository(appInstances);
  protected readonly bay = $inject(BayRemovalService);
  protected readonly inventories = $inject(HostInventoryService);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<Map<number, CardValue>> {
    const out = new Map<number, CardValue>();
    for (const entry of cards) {
      out.set(entry.card.id, await this.resolve(entry));
    }
    return out;
  }

  protected async resolve(entry: DashboardResolvable): Promise<CardValue> {
    const project = entry.scope.projects[0];
    if (!project) return { empty: "noBackup", detail: {} };
    const slug = project.slug ?? "";

    const sigilIds = entry.scope.sigilIds;
    if (sigilIds && sigilIds.length === 0) {
      return { empty: "noBackup", detail: {} };
    }
    const copies = await this.instances.findMany({
      where: {
        projectId: { eq: project.id },
        ephemeral: { eq: false },
        hostId: { isNotNull: true },
        ...(sigilIds ? { sigilId: { inArray: sigilIds } } : {}),
      },
      orderBy: [
        { column: "app", direction: "asc" },
        { column: "env", direction: "asc" },
      ],
    });

    // One inventory read per host, whatever the copy count.
    const inventoryOf = new Map<
      string,
      Promise<Awaited<ReturnType<HostInventoryService["findFor"]>>>
    >();
    const reported = await Promise.all(
      copies.map(async (copy) => {
        const target = await this.bay.target(copy);
        if (target.status !== "ok") return undefined;
        const hostId = target.host.id;
        if (!inventoryOf.has(hostId)) {
          inventoryOf.set(hostId, this.inventories.findFor(hostId));
        }
        const inventory = await inventoryOf.get(hostId);
        const app = inventory?.apps.find(
          (it) => it.app === target.machineApp && it.env === copy.env,
        );
        return app ? { copy, app } : undefined;
      }),
    );

    const rows = reported
      .flatMap((it) => {
        const state = it && BackupFreshnessMetric.stateOf(it.app);
        return it && state
          ? [{ state, row: this.row(it.copy, it.app, state, slug) }]
          : [];
      })
      .sort((a, b) => this.risk(a.state) - this.risk(b.state))
      .map((it) => it.row);
    if (rows.length === 0) return { empty: "noBackup", detail: {} };

    const link = this.catalog
      .get(this.metric)
      .link(entry.card.scope, { projectSlug: slug });
    return {
      value: rows.filter((row) => row.state === "ok").length,
      rows,
      detail: { copies: rows.length },
      ...(link ? { link } : {}),
    };
  }

  /**
   * One backed up copy's row: its size as the title, the age of its last
   * snapshot as the time, its state as a pill when it is not fresh.
   */
  protected row(
    copy: AppInstance,
    app: HostInventoryApp,
    state: BackupFreshnessState,
    slug: string,
  ): Row {
    const last = app.backup?.last;
    const at = last?.at ?? app.lastBackupAt;
    const bytes = last?.storedBytes ?? last?.rawBytes;
    const badge = BackupFreshnessMetric.BADGES[state];
    return {
      id: `${copy.app}/${copy.env}`,
      title: bytes === undefined ? "" : BackupFreshnessMetric.size(bytes),
      ...(badge ? { badge } : {}),
      ...(at ? { at } : {}),
      state: BackupFreshnessMetric.TONES[state],
      ...(slug
        ? {
            link: {
              route: "appBackups",
              params: { projectSlug: slug, app: copy.app, env: copy.env },
            },
          }
        : {}),
    };
  }

  /**
   * The state Bay gives a copy's backups, read from its whole picture when
   * the machine sends one and from the flat fields otherwise. `undefined`
   * when the copy is not backed up at all (off, or no bucket).
   */
  public static stateOf(
    app: HostInventoryApp,
  ): BackupFreshnessState | undefined {
    const reported = app.backup?.state;
    if (reported) {
      if (reported === "off" || reported === "unconfigured") return undefined;
      if (
        reported === "restore-pending" ||
        reported === "failing" ||
        reported === "stale" ||
        reported === "never" ||
        reported === "ok"
      ) {
        return reported;
      }
      // A state a later Bay adds: red when it carries a failure, otherwise
      // shown untoned, never as fresh, rather than dropped.
      return app.backup?.failure ? "failing" : "unknown";
    }
    if (!app.backups) return undefined;
    if (app.lastBackupError) return "failing";
    if (!app.lastBackupAt) return "never";
    return app.backupStale ? "stale" : "ok";
  }

  /**
   * The pill each state carries: none for a fresh backup.
   */
  public static readonly BADGES: Record<
    BackupFreshnessState,
    string | undefined
  > = {
    "restore-pending": "backupRestorePending",
    failing: "backupFailing",
    stale: "backupStale",
    never: "backupNever",
    ok: undefined,
    unknown: undefined,
  };

  /**
   * The tone each state reads in.
   */
  public static readonly TONES: Record<
    BackupFreshnessState,
    "ok" | "warn" | "bad" | "neutral"
  > = {
    "restore-pending": "bad",
    failing: "bad",
    stale: "warn",
    never: "warn",
    ok: "ok",
    unknown: "neutral",
  };

  /**
   * A state's place, worst first: the console's own order.
   */
  protected risk(state: BackupFreshnessState): number {
    const index = (BACKUP_STATE_RISK as readonly string[]).indexOf(state);
    return index === -1 ? BACKUP_STATE_RISK.length : index;
  }

  /**
   * A snapshot's size as a person reads it: `512 B`, `48 KB`, `1.2 GB`.
   */
  public static size(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const shown =
      unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
    return `${shown} ${units[unit]}`;
  }
}

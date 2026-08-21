import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { type Sigil, sigils } from "../entities/sigils.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DailyVisitorsService } from "./DailyVisitorsService.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";

/**
 * Yesterday's audience, against the day before.
 *
 * ## Uniques, never views
 *
 * `insightsResourceSchema` is explicit: `totalViews` is best-effort and
 * inflatable by anyone holding a sigil token, while `uniqueVisitors` is the
 * abuse-resistant headline. A delta amplifies whatever noise is in both of
 * its windows, so it belongs on the number that cannot be inflated.
 *
 * ## No `estimated` flag, and that is not an omission
 *
 * `insightsResourceSchema` carries `estimated` / `sampleInterval` so a UI
 * never renders a sampled number in the typography of a measured one. This
 * tile sets neither, because a distinct visitor count cannot be sampled: it
 * comes from `sigil_uniques_daily`, the one table `$analytics()` cannot
 * answer for precisely because sampling and rollup both destroy the ability
 * to say "have I seen this hash before". Uniques are always exact. A views
 * or page-views tile would have to carry the flags; this one has nothing to
 * disclose.
 *
 * ## Beacon or nothing
 *
 * An app whose `kinds` lacks `beacon` reports no page views at all, and its
 * analytics route 404s (`assertBeacon` in `AppRouter`). So beacon-less apps
 * are filtered out of the measurement AND out of the link: a card that
 * counted a silent app would report a permanent zero, and a link that
 * targeted one would be a link to an error page. With no beacon app in
 * scope the card says so through `detail.noBeaconApp` rather than rendering
 * a zero that looks like a traffic collapse.
 */
export class UniqueVisitorsMetric implements DashboardMetricResolver {
  readonly metric = "uniqueVisitors";

  protected readonly sigils = $repository(sigils);
  protected readonly visitors = $inject(DailyVisitorsService);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    for (const entry of cards) {
      out.set(entry.card.id, await this.resolveOne(entry));
    }

    return out;
  }

  protected async resolveOne(
    entry: DashboardResolvable,
  ): Promise<Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">> {
    const beacons = (await this.scopedApps(entry)).filter((sigil) =>
      sigil.kinds?.includes("beacon"),
    );

    if (beacons.length === 0) {
      // Deliberately not `value: 0`. "No app is reporting" and "nobody
      // visited" are different facts and only one of them is about traffic.
      return { detail: { noBeaconApp: true } };
    }

    const daily = await this.visitors.read(beacons.map((it) => it.id));
    const project = entry.scope.projects.find(
      (it) => it.id === beacons[0]!.projectId,
    );

    return {
      value: daily.uniqueVisitors,
      delta: daily.delta,
      detail: {
        day: daily.day,
        previous: daily.previousUniqueVisitors,
      },
      // A single app has one destination. With several, the link targets the
      // first beacon app in scope rather than nothing: there is no
      // cross-app analytics page, and "somewhere real" beats "not clickable".
      link: this.catalog.get(this.metric).link(entry.card.scope, {
        projectSlug: project?.slug,
        appName: beacons[0]!.name,
      }),
    };
  }

  /**
   * The apps this card measures.
   *
   * An `apps` scope names them and they are already loaded. A `projects`
   * scope means every app enrolled in those projects, which is a read — the
   * scope service does not fetch them, because most metrics have no use for
   * them.
   */
  protected async scopedApps(entry: DashboardResolvable): Promise<Sigil[]> {
    if (entry.scope.sigilIds) {
      return entry.scope.sigils;
    }
    if (entry.scope.projectIds.length === 0) {
      return [];
    }
    return this.sigils.findMany({
      where: { projectId: { inArray: entry.scope.projectIds } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }
}

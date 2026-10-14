import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";
import { sigils } from "../entities/sigils.ts";

/**
 * One pill per app copy (#Q2657): its last deployment, and whether its sigil
 * is reporting. Club has five copies across three apps.
 *
 * A failed last deployment reads `bad`; a deployment queued or running
 * `accent`; a copy whose sigil is silent `warn`, with no sigil `neutral`,
 * reporting `ok`. Silent is the Apps page's own rule (`appLiveness`): no
 * report in 24 hours.
 */
export class AppHealthMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "appHealth";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly instances = $repository(appInstances);
  protected readonly deployments = $repository(deployments);
  protected readonly sigils = $repository(sigils);

  /**
   * The Apps page's silence threshold (`appLiveness`): a day.
   */
  protected readonly silentAfterMs = 24 * 60 * 60 * 1000;

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
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const slug = project.slug ?? "";
      const copies = await this.instances.findMany({
        where: { projectId: { eq: project.id }, ephemeral: { eq: false } },
        orderBy: [
          { column: "app", direction: "asc" },
          { column: "env", direction: "asc" },
        ],
      });
      if (copies.length === 0) {
        out.set(entry.card.id, { empty: "noSigil", detail: {} });
        continue;
      }
      const [apps, recent] = await Promise.all([
        this.sigils.findMany({ where: { projectId: { eq: project.id } } }),
        this.deployments.findMany({
          where: { projectId: { eq: project.id } },
          orderBy: [{ column: "createdAt", direction: "desc" }],
          limit: 100,
        }),
      ]);
      const sigilOf = new Map(apps.map((app) => [app.id, app]));
      const now = this.dateTime.nowMillis();
      const since = this.dateTime.now().subtract(30, "day").toISOString();
      const rows = copies.map((copy) => {
        const last = recent.find((it) => it.instanceId === copy.id);
        const sigil = copy.sigilId ? sigilOf.get(copy.sigilId) : undefined;
        const silent =
          !!sigil &&
          (!sigil.lastSeenAt ||
            now - Date.parse(sigil.lastSeenAt) > this.silentAfterMs);
        const state =
          last?.status === "failed"
            ? ("bad" as const)
            : last?.status === "queued" || last?.status === "running"
              ? ("accent" as const)
              : !sigil
                ? ("neutral" as const)
                : silent
                  ? ("warn" as const)
                  : ("ok" as const);
        return {
          id: `${copy.app}/${copy.env}`,
          title: copy.app,
          meta: last?.tag,
          state,
          link: {
            route: "projectApp",
            params: { projectSlug: slug, app: copy.app, env: copy.env },
          },
        };
      });
      out.set(entry.card.id, {
        value: rows.filter((row) => row.state === "ok").length,
        rows,
        detail: {
          copies: rows.length,
          heard: apps.some(
            (app) => !!app.lastSeenAt && app.lastSeenAt >= since,
          ),
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}

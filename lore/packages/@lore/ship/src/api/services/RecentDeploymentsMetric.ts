import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;
type Row = NonNullable<DashboardCardValue["rows"]>[number];
type RunRow = Pick<
  Deployment,
  | "id"
  | "instanceId"
  | "tag"
  | "status"
  | "versionId"
  | "createdBy"
  | "createdAt"
  | "startedAt"
>;

/**
 * `recentDeployments` (#Q4522): what went out, where, when and by whom. One
 * row per deployment, newest first, across every copy in scope: the copy as
 * its `app/env` chip, the tag it deployed, its status as a pill, who started
 * it and when.
 *
 * - **A scope of apps narrows to their copies**: a copy is in scope when its
 *   sigil is, so a card can follow production only.
 * - **A rollback reads `rolledBack`**: a fast rollback that succeeded is a
 *   new run carrying the Cloudflare version of an earlier succeeded run of
 *   the same copy (`RollbackService.rollback`). A Bay rollback redeploys the
 *   stored artifact, which is an ordinary deploy, and reads as one: nothing
 *   on the row tells them apart.
 * - **A failure, a cancellation and a rollback carry a tone**, `bad` for the
 *   first and `warn` for the other two; a run in flight `accent`.
 *
 * Every deployment, not only the board's window: the card answers "what was
 * the last thing that went out", which a quiet fortnight must not hide.
 * Empty (`noDeployment`) when the scope has no deployment yet.
 */
export class RecentDeploymentsMetric implements DashboardMetricResolver {
  /**
   * The rows a tile shows, by its height: what fits above its "See all"
   * with each row's author on a second line. More would be cut off by the
   * tile, "See all" with them; the rest is each copy's Deploy tab.
   */
  public static readonly ROWS_BY_HEIGHT: Record<number, number> = {
    1: 2,
    2: 6,
  };

  /**
   * The most copy ids one query binds: under D1's hundred-parameter
   * ceiling (folio #F1173), with room for the project id.
   */
  public static readonly CHUNK = 90;

  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "recentDeployments";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly instances = $repository(appInstances);
  protected readonly deployments = $repository(deployments);
  protected readonly users = $repository(users);

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
    if (!project) return { empty: "noDeployment", detail: {} };
    const slug = project.slug ?? "";

    const copies = await this.copiesInScope(entry, project.id);
    if (copies.length === 0) return { empty: "noDeployment", detail: {} };
    const copyOf = new Map(copies.map((copy) => [copy.id, copy]));

    const shown = await this.latestRuns(
      [...copyOf.keys()],
      project.id,
      RecentDeploymentsMetric.ROWS_BY_HEIGHT[entry.card.height ?? 1] ??
        RecentDeploymentsMetric.ROWS_BY_HEIGHT[2]!,
    );
    if (shown.length === 0) return { empty: "noDeployment", detail: {} };
    const rollbacks = await this.rollbacks(shown);

    const authors = [
      ...new Set(
        shown.map((run) => run.createdBy).filter((id): id is string => !!id),
      ),
    ];
    const people = authors.length
      ? await this.users.findMany({ where: { id: { inArray: authors } } })
      : [];
    const nameOf = new Map(
      people.map((person) => [person.id, displayName(person, "")]),
    );

    const rows = shown.map((run): Row => {
      const copy = copyOf.get(run.instanceId)!;
      const badge = rollbacks.has(run.id) ? "rolledBack" : run.status;
      return {
        id: `${copy.app}/${copy.env}`,
        title: run.tag,
        badge,
        state: RecentDeploymentsMetric.stateOf(badge),
        // When it started: the order the rows are in, so a long deploy
        // that finished after a quick one never reads out of order.
        at: run.startedAt ?? run.createdAt,
        excerpt: (run.createdBy && nameOf.get(run.createdBy)) || undefined,
        ...(slug
          ? {
              link: {
                route: "appDeploy",
                params: { projectSlug: slug, app: copy.app, env: copy.env },
              },
            }
          : {}),
      };
    });

    const link = this.catalog
      .get(this.metric)
      .link(entry.card.scope, { projectSlug: slug });
    return {
      value: rows.length,
      rows,
      detail: {
        failed: rows.filter((row) => row.badge === "failed").length,
      },
      ...(link ? { link } : {}),
    };
  }

  /**
   * The pill's tone of a status, or of `rolledBack`.
   */
  public static stateOf(
    badge: string,
  ): "ok" | "warn" | "bad" | "accent" | "neutral" {
    if (badge === "succeeded") return "ok";
    if (badge === "failed") return "bad";
    if (badge === "rolledBack" || badge === "cancelled") return "warn";
    if (badge === "queued" || badge === "running") return "accent";
    return "neutral";
  }

  /**
   * The copies the card follows: every lasting copy of the project, or,
   * for a scope of apps, those whose sigil is in it. A preview copy
   * (`ephemeral`) is left out, as the health tile leaves it out.
   */
  protected async copiesInScope(
    entry: DashboardResolvable,
    projectId: number,
  ): Promise<AppInstance[]> {
    const sigilIds = entry.scope.sigilIds;
    if (sigilIds && sigilIds.length === 0) return [];
    return this.instances.findMany({
      where: {
        projectId: { eq: projectId },
        ephemeral: { eq: false },
        ...(sigilIds ? { sigilId: { inArray: sigilIds } } : {}),
      },
    });
  }

  /**
   * The newest runs of these copies, newest first. Filtered by copy in the
   * query itself, never after it, so the runs of a preview copy cannot push
   * a lasting copy's off the read. Never `log`, which holds a whole deploy
   * log per row (#Q2682).
   */
  protected async latestRuns(
    instanceIds: string[],
    projectId: number,
    limit: number,
  ): Promise<RunRow[]> {
    const chunks: string[][] = [];
    for (
      let i = 0;
      i < instanceIds.length;
      i += RecentDeploymentsMetric.CHUNK
    ) {
      chunks.push(instanceIds.slice(i, i + RecentDeploymentsMetric.CHUNK));
    }
    const reads = await Promise.all(
      chunks.map((ids) =>
        this.deployments.findMany({
          columns: [
            "id",
            "instanceId",
            "tag",
            "status",
            "versionId",
            "createdBy",
            "createdAt",
            "startedAt",
          ],
          where: {
            projectId: { eq: projectId },
            instanceId: { inArray: ids },
          },
          orderBy: [{ column: "createdAt", direction: "desc" }],
          limit,
        }),
      ),
    );
    return reads
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /**
   * The runs among these that are fast rollbacks: a succeeded run carrying
   * the Cloudflare version of an earlier succeeded run of the same copy,
   * which only `RollbackService.rollback` writes, since an upload always
   * makes a new version. A rollback that failed or is still running keeps
   * its own status. One read per candidate, a handful at most.
   */
  protected async rollbacks(runs: RunRow[]): Promise<Set<string>> {
    const found = await Promise.all(
      runs
        .filter((run) => run.status === "succeeded" && !!run.versionId)
        .map(async (run) => {
          const [earlier] = await this.deployments.findMany({
            columns: ["id"],
            where: {
              instanceId: { eq: run.instanceId },
              versionId: { eq: run.versionId! },
              status: { eq: "succeeded" },
              createdAt: { lt: run.createdAt },
            },
            limit: 1,
          });
          return earlier ? run.id : undefined;
        }),
    );
    return new Set(found.filter((id): id is string => !!id));
  }
}

import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import {
  type ProjectDashboardCard,
  projectDashboardCards,
} from "../entities/projectDashboardCards.ts";
import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardScope } from "../schemas/dashboardScopeSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";

/**
 * Storage and layout of one project's dashboard cards.
 *
 * The project-board twin of `DashboardCardService`, and deliberately not a
 * branch inside it: the board belongs to the project rather than to the
 * reader, so every query names a `projectId` and none of them names a user.
 *
 * Two rules live here rather than in the controller:
 *
 * 1. **Validation is against the registry, both ways.** A card is written
 *    only if its metric exists, may be offered on a project board, accepts
 *    that scope kind, and its filters parse. It is read back with its filters
 *    re-parsed, so a card stored before a metric's vocabulary changed
 *    degrades to that metric's defaults instead of resolving against a
 *    half-understood config.
 * 2. **Nothing seeds.** {@link list} returns what is there, which on a new
 *    project is an empty array, and it writes nothing on the way. There is no
 *    seeding marker here because there is nothing for one to tell apart —
 *    see `projectDashboardCards`.
 */
export class ProjectDashboardCardService {
  protected readonly cards = $repository(projectDashboardCards);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  /**
   * This project's cards, in grid order.
   *
   * ⚠️ Writes nothing. A project that has never been looked at and a project
   * whose board was emptied by hand are the same state on purpose.
   */
  async list(projectId: number): Promise<DashboardCardResource[]> {
    const rows = await this.cards.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
    return rows.map((row) => this.toResource(row));
  }

  /**
   * Add a card at the end of the grid.
   */
  async add(
    projectId: number,
    input: {
      metric: string;
      scope: DashboardScope;
      filters?: Record<string, unknown>;
      size?: number;
    },
  ): Promise<DashboardCardResource> {
    const filters = this.validate(input.metric, input.scope, input.filters);

    const last = await this.cards.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "position", direction: "desc" }],
      limit: 1,
    });

    const row = await this.cards.create({
      projectId,
      metric: input.metric,
      scope: input.scope,
      filters,
      size: input.size ?? 1,
      position: (last[0]?.position ?? -1) + 1,
    });

    return this.toResource(row);
  }

  /**
   * Change a card's metric configuration or its width.
   */
  async update(
    projectId: number,
    cardId: number,
    input: {
      metric?: string;
      scope?: DashboardScope;
      filters?: Record<string, unknown>;
      size?: number;
    },
  ): Promise<DashboardCardResource> {
    const current = await this.own(projectId, cardId);
    const metric = input.metric ?? current.metric;
    const scope = input.scope ?? current.scope;
    // A metric change invalidates the old filters by definition, so they are
    // re-derived from the new metric's defaults unless the caller sent some.
    const filters = this.validate(
      metric,
      scope,
      input.filters ?? (input.metric ? undefined : current.filters),
    );

    const row = await this.cards.updateOne(
      { id: { eq: current.id } },
      { metric, scope, filters, size: input.size ?? current.size },
    );

    return this.toResource(row);
  }

  /**
   * Remove one card from this project's board.
   */
  async remove(projectId: number, cardId: number): Promise<void> {
    const current = await this.own(projectId, cardId);
    await this.cards.deleteMany({ id: { eq: current.id } });
  }

  /**
   * Persist a new grid order.
   *
   * Takes the full id list rather than a moved-card delta: a partial list
   * cannot describe a reorder without the client and the server agreeing on
   * what happened to the cards it left out.
   */
  async reorder(projectId: number, ids: number[]): Promise<void> {
    const mine = await this.cards.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    const owned = new Set(mine.map((it) => it.id));

    if (ids.length !== owned.size || ids.some((id) => !owned.has(id))) {
      throw new BadRequestError("Reorder must list every card exactly once");
    }

    await Promise.all(
      ids.map((id, position) =>
        this.cards.updateOne({ id: { eq: id } }, { position }),
      ),
    );
  }

  /**
   * One of this project's cards, or a 400 — never another project's.
   */
  protected async own(
    projectId: number,
    cardId: number,
  ): Promise<ProjectDashboardCard> {
    const row = await this.cards.findOne({
      where: { id: { eq: cardId }, projectId: { eq: projectId } },
    });
    if (!row) {
      throw new BadRequestError("Card not found");
    }
    return row;
  }

  /**
   * Everything that must be true before a card is stored: the metric exists,
   * it may be offered on a project board, it accepts this scope kind, and its
   * filters parse.
   *
   * The scope's own ids are proved against the project by the controller,
   * which is the only layer that knows which project the route named.
   */
  protected validate(
    metric: string,
    scope: DashboardScope,
    filters: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const descriptor = this.catalog.find(metric);
    if (!descriptor) {
      throw new BadRequestError(`Unknown metric: ${metric}`);
    }
    if (!this.catalog.accepts(metric, scope.kind)) {
      throw new BadRequestError(
        `Metric ${metric} does not accept a ${scope.kind} scope on a project board`,
      );
    }

    try {
      return this.catalog.parseFilters(metric, filters ?? {});
    } catch {
      throw new BadRequestError(`Invalid filters for metric ${metric}`);
    }
  }

  /**
   * A stored row as the browser reads it.
   *
   * Filters are re-parsed on the way out. A card written before its metric's
   * vocabulary changed degrades to that metric's defaults rather than
   * reaching the UI as a shape nothing understands — one stale card must
   * never cost the board.
   */
  protected toResource(row: ProjectDashboardCard): DashboardCardResource {
    let filters: Record<string, unknown>;
    try {
      filters = this.catalog.parseFilters(row.metric, row.filters);
    } catch {
      filters = this.catalog.find(row.metric)
        ? this.catalog.defaultFilters(row.metric)
        : {};
    }

    return {
      id: row.id,
      metric: row.metric,
      scope: row.scope,
      filters,
      size: row.size ?? 1,
      position: row.position ?? 0,
    };
  }
}

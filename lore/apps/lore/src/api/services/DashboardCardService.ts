import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import {
  type DashboardCard,
  dashboardCards,
} from "../entities/dashboardCards.ts";
import { dashboardSettings } from "../entities/dashboardSettings.ts";
import { sigils } from "../entities/sigils.ts";
import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardScope } from "../schemas/dashboardScopeSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import { DashboardScopeService } from "./DashboardScopeService.ts";

/**
 * Storage and layout of one user's dashboard cards.
 *
 * Owns the two rules the controller must not be trusted with:
 *
 * 1. **Validation is against the registry, both ways.** A card is written
 *    only if its metric exists, accepts that scope kind, and its filters
 *    parse. It is read back with its filters re-parsed — a card stored
 *    before a metric's vocabulary changed degrades to that metric's defaults
 *    instead of resolving against a half-understood config.
 * 2. **Seeding happens exactly once.** See `dashboardSettings`: zero rows
 *    means both "never seeded" and "the user removed every card", and only
 *    the marker tells them apart.
 */
export class DashboardCardService {
  protected readonly cards = $repository(dashboardCards);
  protected readonly settings = $repository(dashboardSettings);
  protected readonly sigils = $repository(sigils);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * This user's cards, seeding the default set on the very first visit.
   *
   * The seed is a side effect of the first read rather than of registration,
   * so every account that predates the dashboard gets one too.
   */
  async list(user: UserAccountToken): Promise<DashboardCardResource[]> {
    const marker = await this.settings.findOne({
      where: { userId: { eq: user.id } },
    });

    if (!marker) {
      await this.settings.create({
        userId: user.id,
        seededAt: this.dateTime.now().toISOString(),
      });
      await this.seed(user);
    }

    return this.read(user);
  }

  /** This user's cards, in grid order, without ever seeding. */
  async read(user: UserAccountToken): Promise<DashboardCardResource[]> {
    const rows = await this.cards.findMany({
      where: { userId: { eq: user.id } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
    return rows.map((row) => this.toResource(row));
  }

  /**
   * Add a card at the end of the grid.
   *
   * The scope is proved against the caller's memberships here and not only
   * at resolve time: storing an id the caller cannot see would make the
   * containment check the only thing standing between a stored row and a
   * cross-tenant read.
   */
  async add(
    user: UserAccountToken,
    input: {
      metric: string;
      scope: DashboardScope;
      filters?: Record<string, unknown>;
      size?: number;
    },
  ): Promise<DashboardCardResource> {
    const filters = await this.validate(
      user,
      input.metric,
      input.scope,
      input.filters,
    );

    const last = await this.cards.findMany({
      where: { userId: { eq: user.id } },
      orderBy: [{ column: "position", direction: "desc" }],
      limit: 1,
    });

    const row = await this.cards.create({
      userId: user.id,
      metric: input.metric,
      scope: input.scope,
      filters,
      size: input.size ?? 1,
      position: (last[0]?.position ?? -1) + 1,
    });

    return this.toResource(row);
  }

  /** Change a card's metric configuration or its width. */
  async update(
    user: UserAccountToken,
    cardId: number,
    input: {
      metric?: string;
      scope?: DashboardScope;
      filters?: Record<string, unknown>;
      size?: number;
    },
  ): Promise<DashboardCardResource> {
    const current = await this.own(user, cardId);
    const metric = input.metric ?? current.metric;
    const scope = input.scope ?? current.scope;
    // A metric change invalidates the old filters by definition, so they are
    // re-derived from the new metric's defaults unless the caller sent some.
    const filters = await this.validate(
      user,
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

  /** Remove one card. Leaves the seeding marker alone. */
  async remove(user: UserAccountToken, cardId: number): Promise<void> {
    const current = await this.own(user, cardId);
    await this.cards.deleteMany({ id: { eq: current.id } });
  }

  /**
   * Persist a new grid order.
   *
   * Takes the full id list rather than a moved-card delta: the grid is small,
   * one statement per card is cheap, and a partial list cannot describe a
   * reorder without the client and the server agreeing on what happened to
   * the cards it left out.
   */
  async reorder(user: UserAccountToken, ids: number[]): Promise<void> {
    const mine = await this.cards.findMany({
      where: { userId: { eq: user.id } },
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
   * Drop every card and write the default set again.
   *
   * Deliberately does NOT touch the seeding marker: reset restores defaults
   * because the user asked, and emptying the board afterwards must still be
   * a state that survives a reload.
   */
  async reset(user: UserAccountToken): Promise<void> {
    await this.cards.deleteMany({ userId: { eq: user.id } });
    await this.seed(user);
  }

  /**
   * The starting dashboard.
   *
   * Three `all`-scoped cards that are meaningful for any account, plus
   * yesterday's visitors when the user actually has an app that reports
   * them. A metric with no data available is not offered, so it is not
   * seeded either.
   *
   * The order follows the mockup's own default set: visitors, quests,
   * blights, feedback.
   */
  protected async seed(user: UserAccountToken): Promise<void> {
    const cards: Array<{ metric: string; scope: DashboardScope }> = [];

    const beacon = await this.firstBeaconApp(user);
    if (beacon) {
      cards.push({
        metric: "uniqueVisitors",
        scope: { kind: "apps", sigilIds: [beacon] },
      });
    }
    cards.push({ metric: "activeQuests", scope: { kind: "all" } });
    cards.push({ metric: "openBlights", scope: { kind: "all" } });
    cards.push({ metric: "untriagedFeedback", scope: { kind: "all" } });

    await this.cards.createMany(
      cards.map((card, position) => ({
        userId: user.id,
        metric: card.metric,
        scope: card.scope,
        filters: this.catalog.defaultFilters(card.metric),
        size: 1,
        position,
      })),
    );
  }

  /**
   * The caller's first beacon-carrying app, if any.
   *
   * Beacon and not merely "an app": the visitors metric reads page traffic,
   * and an app without the `beacon` kind reports none — and its analytics
   * page 404s, so the card could not even be clicked.
   */
  protected async firstBeaconApp(
    user: UserAccountToken,
  ): Promise<string | undefined> {
    const visible = await this.scopes.visibleProjects(user);
    if (visible.length === 0) return undefined;

    const rows = await this.sigils.findMany({
      where: { projectId: { inArray: visible.map((it) => it.id) } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    return rows.find((it) => it.kinds?.includes("beacon"))?.id;
  }

  /** One of this user's cards, or a 400 — never someone else's. */
  protected async own(
    user: UserAccountToken,
    cardId: number,
  ): Promise<DashboardCard> {
    const row = await this.cards.findOne({
      where: { id: { eq: cardId }, userId: { eq: user.id } },
    });
    if (!row) {
      throw new BadRequestError("Card not found");
    }
    return row;
  }

  /**
   * Everything that must be true before a card is stored: the metric exists,
   * it accepts this scope kind, the scope is well-formed and inside the
   * caller's memberships, and the filters parse.
   */
  protected async validate(
    user: UserAccountToken,
    metric: string,
    scope: DashboardScope,
    filters: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const descriptor = this.catalog.find(metric);
    if (!descriptor) {
      throw new BadRequestError(`Unknown metric: ${metric}`);
    }
    if (!descriptor.scopeKinds.includes(scope.kind)) {
      throw new BadRequestError(
        `Metric ${metric} does not accept a ${scope.kind} scope`,
      );
    }
    await this.scopes.resolve(scope, user);

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
   * never cost the dashboard.
   */
  protected toResource(row: DashboardCard): DashboardCardResource {
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

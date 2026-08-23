import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { dashboardCardResourceSchema } from "../schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "../schemas/dashboardCardValueSchema.ts";
import { dashboardScopeSchema } from "../schemas/dashboardScopeSchema.ts";
import { DashboardCardService } from "../services/DashboardCardService.ts";
import { DashboardMetricRegistry } from "../services/DashboardMetricRegistry.ts";

/**
 * The logged-in landing page's own endpoints.
 *
 * Per user, not per project — which is why every path here hangs off `/me`
 * rather than `/projects/:projectId`, following `FeedbackController`'s
 * `/me/feedback`. The consequence is that no single `assertMember` can gate
 * them: a card may name several projects, or apps across projects. The gate
 * moved into `DashboardScopeService`, which proves every id against the
 * caller's membership set before it narrows anything.
 *
 * This class stores and returns configuration. Turning a card into a number
 * is `resolveCards`, which takes the whole list in one request — ten
 * auto-refreshing tiles on the landing page is the exact shape of the
 * QuestGraph incident, so there is one endpoint and no polling.
 */
export class DashboardController {
  protected readonly cards = $inject(DashboardCardService);
  protected readonly registry = $inject(DashboardMetricRegistry);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * This user's cards, in grid order.
   *
   * Seeds the default set on the very first call, once — see
   * `dashboardSettings` for why "zero cards" alone cannot decide that.
   */
  listCards = $action({
    use: [$secure()],
    method: "GET",
    path: "/me/dashboard/cards",
    schema: {
      response: z.object({
        cards: z.array(dashboardCardResourceSchema),
      }),
    },
    handler: async ({ user }) => ({
      cards: await this.cards.list(user),
    }),
  });

  addCard = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/dashboard/cards",
    schema: {
      body: z.object({
        metric: z.string().min(1).max(64),
        scope: dashboardScopeSchema,
        filters: z.record(z.text(), z.any()).optional(),
        size: z.integer().min(1).max(6).optional(),
      }),
      response: dashboardCardResourceSchema,
    },
    handler: async ({ body, user }) =>
      this.cards.add(user, {
        metric: body.metric,
        scope: body.scope,
        filters: body.filters,
        size: body.size,
      }),
  });

  updateCard = $action({
    use: [$secure()],
    method: "PATCH",
    path: "/me/dashboard/cards/:cardId",
    schema: {
      params: z.object({ cardId: z.integer() }),
      body: z.object({
        metric: z.string().min(1).max(64).optional(),
        scope: dashboardScopeSchema.optional(),
        filters: z.record(z.text(), z.any()).optional(),
        size: z.integer().min(1).max(6).optional(),
      }),
      response: dashboardCardResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.cards.update(user, params.cardId, {
        metric: body.metric,
        scope: body.scope,
        filters: body.filters,
        size: body.size,
      }),
  });

  removeCard = $action({
    use: [$secure()],
    method: "DELETE",
    path: "/me/dashboard/cards/:cardId",
    schema: {
      params: z.object({ cardId: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.cards.remove(user, params.cardId);
      return { ok: true };
    },
  });

  /**
   * Persist a new grid order.
   *
   * The body is the complete id list, in the order the grid now shows — a
   * drag is described by where everything ended up, not by what moved.
   */
  reorderCards = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/dashboard/cards/order",
    schema: {
      body: z.object({ ids: z.array(z.integer()).max(100) }),
      response: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ body, user }) => {
      await this.cards.reorder(user, body.ids);
      return { cards: await this.cards.read(user) };
    },
  });

  /**
   * Turn the whole card list into values, in one request.
   *
   * ⚠️ **One endpoint, and no polling.** Ten auto-refreshing tiles on the
   * landing page is the exact shape of the QuestGraph incident (folio
   * #1057) — 4,009 identical `/api/_batch` requests from one browser tab in
   * 51 minutes, roughly 35% of that day's account-wide Worker invocations.
   * `/api/_batch` collapses transport, not database work, so this takes the
   * whole list and `DashboardMetricRegistry` groups it by metric before
   * resolving. `refreshedAt` is a timestamp on an explicit refresh; nothing
   * on the dashboard polls.
   *
   * The cards are read from storage rather than taken from the body: they
   * are the caller's own rows, the server is already the source of truth for
   * them, and a body-supplied list would only add a way for the two to
   * disagree. `cardIds` narrows it — for resolving a single card just added
   * or reconfigured, without re-running every other metric.
   */
  resolveCards = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/dashboard/resolve",
    schema: {
      body: z.object({
        cardIds: z.array(z.integer()).max(100).optional(),
      }),
      response: z.object({
        values: z.array(dashboardCardValueSchema),
        /**
         * When these numbers were read. The header's "refreshed ..." line,
         * and the reason it can say that honestly.
         */
        refreshedAt: z.string(),
      }),
    },
    handler: async ({ body, user }) => {
      const all = await this.cards.list(user);
      const wanted = body.cardIds ? new Set(body.cardIds) : undefined;
      const cards = wanted ? all.filter((card) => wanted.has(card.id)) : all;

      return {
        values: await this.registry.resolve(cards, user),
        refreshedAt: this.dateTime.now().toISOString(),
      };
    },
  });

  /**
   * Restore the default card set, keeping the seeding marker.
   */
  resetLayout = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/dashboard/reset",
    schema: {
      response: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ user }) => {
      await this.cards.reset(user);
      return { cards: await this.cards.read(user) };
    },
  });
}

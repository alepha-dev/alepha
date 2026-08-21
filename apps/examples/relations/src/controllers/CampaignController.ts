import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { CampaignService } from "../services/CampaignService.ts";

/**
 * A controller in the shape Lore actually writes them.
 *
 * The point of putting one here is that the interesting part is missing: there
 * is no id-collecting, no `inArray` follow-up query, and no `Map` to stitch
 * rows back together. The handler returns what the query already shaped.
 */
export class CampaignController {
  campaigns = $inject(CampaignService);

  /**
   * Before:
   *
   * ```ts
   * const characters = await this.characters.findMany({
   *   where: { campaignId: { eq: params.id } },
   * });
   * const userIds = characters.map((it) => it.userId);
   * const users = await this.users.findMany({
   *   where: { id: { inArray: userIds } },
   * });
   * const byId = new Map(users.map((u) => [u.id, u]));
   * return characters.map((c) => ({ ...c, user: byId.get(c.userId) }));
   * ```
   */
  listMembers = $action({
    path: "/api/campaigns/:id/members",
    schema: {
      params: z.object({ id: z.coerce.number() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) =>
      (await this.campaigns.members(params.id)) as any,
  });

  getOverview = $action({
    path: "/api/campaigns/:id",
    schema: {
      params: z.object({ id: z.coerce.number() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) =>
      (await this.campaigns.overview(params.id)) as any,
  });

  getQuestBoard = $action({
    path: "/api/campaigns/:id/quests",
    schema: {
      params: z.object({ id: z.coerce.number() }),
      query: z.object({ page: z.coerce.number().default(0) }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params, query }) =>
      (await this.campaigns.questBoard(params.id, query.page)) as any,
  });

  /**
   * The whole graph is written in one transaction. Lore's equivalent wraps the
   * handler in `$transactional()` and threads the new campaign id into each
   * character by hand.
   */
  createCampaign = $action({
    method: "POST",
    path: "/api/campaigns",
    schema: {
      body: z.object({
        title: z.string().min(1),
        ownerId: z.uuid(),
        party: z
          .array(
            z.object({
              name: z.string().min(1),
              level: z.integer().min(1).optional(),
            }),
          )
          .default([]),
      }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ body }) => (await this.campaigns.found(body)) as any,
  });

  renameCampaign = $action({
    method: "PATCH",
    path: "/api/campaigns/:id",
    schema: {
      params: z.object({ id: z.coerce.number() }),
      body: z.object({ title: z.string().min(1) }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params, body }) =>
      (await this.campaigns.rename(params.id, body.title)) as any,
  });

  watchQuest = $action({
    method: "PUT",
    path: "/api/quests/:questId/watchers/:userId",
    schema: {
      params: z.object({ questId: z.coerce.number(), userId: z.uuid() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) =>
      (await this.campaigns.watch(params.questId, params.userId)) as any,
  });
}

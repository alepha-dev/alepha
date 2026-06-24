import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected campaigns = $repository(campaigns);
  protected quests = $repository(quests);
  protected security = $inject(AppSecurityProvider);
  protected questMapper = $inject(QuestResourceMapper);

  /**
   * Get all quests for a campaign, grouped for kanban display. Members
   * only — Lore campaigns are private, there is no public-share path.
   */
  getBoard = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    method: "GET",
    path: "/kanban/:campaignId",
    schema: {
      params: z.object({
        campaignId: z.integer(),
      }),
      response: z.object({
        campaign: campaigns.schema,
        quests: z.array(questResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(
        params.campaignId,
        user,
      );

      const allQuests = await this.quests.findMany({
        where: {
          campaignId: { eq: params.campaignId },
        },
        orderBy: [
          { column: "priority", direction: "desc" },
          { column: "updatedAt", direction: "desc" },
        ],
      });

      return {
        campaign,
        quests: allQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
      };
    },
  });
}

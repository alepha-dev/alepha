import { $inject, Alepha, t } from "alepha";
import { $repository } from "alepha/orm";
import {
  currentUserAtom,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { $action, UnauthorizedError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected campaigns = $repository(campaigns);
  protected quests = $repository(quests);
  protected characters = $repository(characters);
  protected alepha = $inject(Alepha);
  protected security = $inject(SecurityProvider);
  protected questMapper = $inject(QuestResourceMapper);

  /**
   * Get all quests for a campaign, grouped for kanban display.
   * No $secure — supports unauthenticated access to public campaigns.
   */
  getBoard = $action({
    method: "GET",
    path: "/kanban/:campaignId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
      response: t.object({
        campaign: campaigns.schema,
        quests: t.array(questResourceSchema),
        readOnly: t.boolean(),
      }),
    },
    handler: async (req) => {
      const { params } = req;

      // Optionally resolve user (no throw if unauthenticated)
      // Mirrors $secure resolution: atom first, then HTTP request fallback
      let user: UserAccountToken | undefined;
      try {
        user = this.alepha.store.get(currentUserAtom);
        if (!user) {
          const httpRequest = this.alepha.store.get("alepha.http.request");
          if (httpRequest) {
            user = httpRequest.user;
            if (!user) {
              user =
                await this.security.resolveUserFromServerRequest(httpRequest);
            }
          }
        }
      } catch {
        // Not authenticated — fine for public campaigns
      }

      const campaign = await this.campaigns.getOne({
        where: { id: { eq: params.campaignId } },
      });

      // Private campaign requires authentication + membership
      if (!campaign.public) {
        if (!user) {
          throw new UnauthorizedError("Authentication required");
        }
        if (campaign.createdBy !== user.id) {
          // Must be a member — getOne throws NotFoundError if not found
          await this.characters.getOne({
            where: {
              campaignId: { eq: campaign.id },
              userId: { eq: user.id },
            },
          });
        }
      }

      // Determine write access
      let readOnly = true;
      if (user) {
        if (campaign.createdBy === user.id) {
          readOnly = false;
        } else {
          const character = await this.characters.findOne({
            where: {
              campaignId: { eq: campaign.id },
              userId: { eq: user.id },
            },
          });
          readOnly = !character;
        }
      }

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
        readOnly,
      };
    },
  });
}

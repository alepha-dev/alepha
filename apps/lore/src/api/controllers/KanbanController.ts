import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected projects = $repository(projects);
  protected quests = $repository(quests);
  protected security = $inject(ProjectSecurityService);
  protected questMapper = $inject(QuestResourceMapper);

  /**
   * Get all quests for a project, grouped for kanban display. Members
   * only — Lore projects are private, there is no public-share path.
   */
  getBoard = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    method: "GET",
    path: "/kanban/:projectId",
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({
        project: projects.schema,
        quests: z.array(questResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const { project } = await this.security.assertMember(
        params.projectId,
        user,
      );

      const allQuests = await this.quests.findMany({
        where: {
          projectId: { eq: params.projectId },
          // The board has no shelf lane — a shelved quest would otherwise
          // land back in "New", which is exactly the clutter shelving is
          // meant to remove. Unshelve from the quest view to get it back.
          shelvedAt: { isNull: true },
        },
        orderBy: [
          { column: "priority", direction: "desc" },
          { column: "updatedAt", direction: "desc" },
        ],
      });

      return {
        project,
        quests: allQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
      };
    },
  });
}

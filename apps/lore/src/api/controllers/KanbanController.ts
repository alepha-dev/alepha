import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { projectResourceSchema } from "../schemas/projectResourceSchema.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { EpicVisibilityService } from "../services/EpicVisibilityService.ts";
import { ProjectResourceMapper } from "../services/ProjectResourceMapper.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected projects = $repository(projects);
  protected quests = $repository(quests);
  protected security = $inject(ProjectSecurityService);
  protected epicVisibility = $inject(EpicVisibilityService);
  protected questMapper = $inject(QuestResourceMapper);
  protected projectMapper = $inject(ProjectResourceMapper);

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
        project: projectResourceSchema,
        quests: z.array(questResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const { project } = await this.security.assertMember(
        params.projectId,
        user,
      );

      const where = this.quests.createQueryWhere();
      where.projectId = { eq: params.projectId };
      // The board has no shelf lane — a shelved quest would otherwise
      // land back in "New", which is exactly the clutter shelving is
      // meant to remove. Unshelve from the quest view to get it back.
      where.shelvedAt = { isNull: true };

      // Same gate as `QuestController.getQuests`, and it has to be the same
      // one: a quest visible on the board but absent from the list (or the
      // reverse) is precisely the inconsistency this feature exists to
      // prevent. The board has no opt-out — it is a pure UI surface, unlike
      // `getQuests`, which MCP `quest_list` also calls.
      await this.epicVisibility.applyBacklogGate(where, params.projectId);

      const allQuests = await this.quests.findMany({
        where,
        orderBy: [
          { column: "priority", direction: "desc" },
          { column: "updatedAt", direction: "desc" },
        ],
      });

      return {
        project: this.projectMapper.toResource(project),
        quests: allQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
      };
    },
  });
}

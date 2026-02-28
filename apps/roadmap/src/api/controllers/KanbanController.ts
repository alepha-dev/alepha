import { $inject, Alepha, t } from "alepha";
import { $repository } from "alepha/orm";
import {
  currentUserAtom,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { $action, UnauthorizedError } from "alepha/server";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { taskResourceSchema } from "../schemas/taskResourceSchema.ts";
import { TaskResourceMapper } from "../services/TaskResourceMapper.ts";

export class KanbanController {
  protected projects = $repository(projects);
  protected tasks = $repository(tasks);
  protected characters = $repository(characters);
  protected alepha = $inject(Alepha);
  protected security = $inject(SecurityProvider);
  protected taskMapper = $inject(TaskResourceMapper);

  /**
   * Get all tasks for a project, grouped for kanban display.
   * No $secure — supports unauthenticated access to public projects.
   */
  getBoard = $action({
    method: "GET",
    path: "/kanban/:projectId",
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.object({
        project: projects.schema,
        tasks: t.array(taskResourceSchema),
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
        // Not authenticated — fine for public projects
      }

      const project = await this.projects.getOne({
        where: { id: { eq: params.projectId } },
      });

      // Private project requires authentication + membership
      if (!project.public) {
        if (!user) {
          throw new UnauthorizedError("Authentication required");
        }
        if (project.createdBy !== user.id) {
          // Must be a member — getOne throws NotFoundError if not found
          await this.characters.getOne({
            where: {
              projectId: { eq: project.id },
              userId: { eq: user.id },
            },
          });
        }
      }

      // Determine write access
      let readOnly = true;
      if (user) {
        if (project.createdBy === user.id) {
          readOnly = false;
        } else {
          const character = await this.characters.findOne({
            where: {
              projectId: { eq: project.id },
              userId: { eq: user.id },
            },
          });
          readOnly = !character;
        }
      }

      const allTasks = await this.tasks.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [
          { column: "priority", direction: "desc" },
          { column: "updatedAt", direction: "desc" },
        ],
      });

      return {
        project,
        tasks: allTasks.map((task) => this.taskMapper.mapTaskToResource(task)),
        readOnly,
      };
    },
  });
}

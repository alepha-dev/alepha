import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { projects } from "../entities/projects.ts";
import { relations } from "../relations.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { QuestCsvFormatter } from "../services/QuestCsvFormatter.ts";

/**
 * Quests on their way OUT of a project, as CSV.
 *
 * ⚠️ **Export only, and the name is still right.** Quest import - CSV,
 * Trello and AlephaLore alike - was deleted in epic #E48 along with
 * `QuestCsvParser`, `QuestImportFormatProvider`, `parsers/` and the settings
 * card that drove it. "Portability" still covers export, the route is still
 * `/projects/:id/quests/export`, and renaming the controller would churn the
 * controller list for nothing.
 */
export class ProjectQuestPortabilityController {
  protected readonly EXPORT_LIMIT = 1000;

  /**
   * ...with release and the three users a quest names, for the CSV export.
   */
  protected readonly questsWith = $repository(relations, "quests");
  protected readonly projects = $repository(projects);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly formatter = $inject(QuestCsvFormatter);

  exportQuests = $action({
    // A permission, so the token carries a computed `ownership` for the
    // membership gate below (a bare `$secure()` leaves it undefined).
    use: [$ownsProject({ requires: "quest:read", param: "id" })],
    method: "GET",
    path: "/projects/:id/quests/export",
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.file(),
    },
    handler: async ({ params, user }) => {
      const project = await this.projects.getOne({
        where: { id: { eq: params.id } },
      });

      // Release title and the three people a quest names come back with the
      // quest itself, so the export is one statement instead of three.
      const projectQuests = await this.questsWith.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: "shortId",
        limit: this.EXPORT_LIMIT,
        include: {
          release: { select: ["id", "tag"] },
          author: true,
          acceptedByUser: true,
          completedByUser: true,
        },
      });

      const emailOf = (u?: { email?: string; username?: string }): string =>
        u?.email ?? u?.username ?? "";

      const status = (
        q: (typeof projectQuests)[number],
      ): "new" | "accepted" | "completed" =>
        q.completedAt ? "completed" : q.acceptedAt ? "accepted" : "new";

      const text = this.formatter.format(
        projectQuests.map((q) => ({
          shortId: q.shortId,
          title: q.title,
          status: status(q),
          priority: q.priority,
          size: q.size,
          area: q.area ?? "",
          kanbanColumn: q.kanbanColumn ?? "",
          // The TAG, not the title: the tag is unique per project and is
          // what the import below matches on, so a round-trip through this
          // column has to carry the identity rather than a display name.
          release: q.releaseId != null ? (q.release?.tag ?? "") : "",
          createdBy: emailOf(q.author),
          acceptedBy: emailOf(q.acceptedByUser),
          completedBy: emailOf(q.completedByUser),
          createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : "",
          acceptedAt: q.acceptedAt ? new Date(q.acceptedAt).toISOString() : "",
          completedAt: q.completedAt
            ? new Date(q.completedAt).toISOString()
            : "",
          objectives: q.objectives ?? [],
          description: q.description ?? "",
        })),
      );

      const safeTitle = project.title.replace(/[^a-z0-9-]+/gi, "-");
      const date = this.dt.nowISOString().split("T")[0];
      return this.fs.createFile({
        text,
        name: `quests-${safeTitle}-${date}.csv`,
        type: "text/csv",
      });
    },
  });
}

import { ProjectTools } from "@lore/core/mcp";
import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

import { AreaController } from "../../api/controllers/AreaController.ts";

/**
 * MCP tools for areas (#Q3958).
 *
 * An area is named by its NAME here, with its exact casing, as
 * `quest_create` takes it: an agent knows `lore/code`, never its row id.
 * Only the delete for now: `renameArea`, `mergeAreas` and `updateArea` have
 * no tool yet.
 */
export class AreaTools {
  protected readonly areaController = $inject(AreaController);
  protected readonly projectTools = $inject(ProjectTools);

  area_delete = $tool({
    description:
      "Delete an EMPTY area of the project, by its exact name (case matters, as in quest_create's `area`). An area that still holds quests is refused with how many it holds: move them to another area first (quest_update `area`) or merge it in the project's Settings > Areas. Use it to clean up an area left behind by a rename.",
    title: "Delete area",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: z.object({
        name: z.string().describe("The area's exact name, e.g. `lore/code`."),
        project: z
          .integer()
          .describe("Project ID. Required if project_name is not provided.")
          .optional(),
        project_name: z
          .string()
          .describe(
            "Project name (case-insensitive). Alternative to `project`.",
          )
          .optional(),
      }),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projectTools.resolveProjectId(
        params.project,
        params.project_name,
      );
      const areas = await this.areaController.getAreas({
        params: { projectId },
      });
      const area = areas.find((it) => it.name === params.name);
      if (!area) {
        throw new NotFoundError(
          `Area "${params.name}" not found in this project. Names are exact, case included: project_context lists them.`,
        );
      }
      await this.areaController.deleteArea({ params: { id: area.id } });
      return { ok: true };
    },
  });
}

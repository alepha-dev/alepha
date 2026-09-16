import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";
import type { AreaController } from "lore/api/controllers/AreaController";
import type { ProjectController } from "lore/api/controllers/ProjectController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore project list` and `lore project info`.
 *
 * ```bash
 * lore project list
 * lore project info -p alepha --output json
 * ```
 *
 * Named from the MCP tools by one rule, singular and underscore to space:
 * `project_info` is `lore project info`.
 *
 * ## ⚠️ No rank in the list, on purpose
 *
 * `getMyProjects` does not return one, and the owner decided on 2026-09-13
 * that it does not grow to (#F1297, answer 5). `lore project info` names the
 * caller's rank for the project it is asked about.
 *
 * ## ⚠️ The controller types are TYPES, and must stay ones
 *
 * The `lore` workspace is private, so this class is registered as a service
 * and never re-exported from `index.ts`: an exported signature naming
 * `ProjectController` would put that workspace in the published `.d.ts`, and
 * `scripts/check-dts.ts` fails the build if one does.
 */
export class ProjectCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly projectApi = $client<ProjectController>(
    this.client.scope(),
  );
  protected readonly areaApi = $client<AreaController>(this.client.scope());

  public readonly list = $command({
    name: "list",
    description: "List the projects you are a member of, by slug",
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      await this.refusals.guard({}, async () => {
        // An explicit size: `pageQuerySchema` defaults it to 10, so leaving it
        // out would print ten projects and say nothing about the rest.
        const projects = await this.projectApi.getMyProjects({
          query: { size: 100 },
        });

        if (flags.output === "json") {
          this.render.json(print, projects);
          return;
        }

        this.render.list(
          print,
          projects.map((project) => ({
            handle: project.slug,
            title: project.title,
            fields: [
              project.capabilities
                .map((capability) => capability.key)
                .join(","),
            ],
          })),
          undefined,
          "You are not a member of any project.",
        );
      });
    },
  });

  public readonly info = $command({
    name: "info",
    description:
      "Show one project: your rank and permissions in it, and its areas",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const found = await this.projectApi.getProjectById({
          params: { id: projectId },
        });
        const areas = await this.areaApi.getAreas({ params: { projectId } });

        if (flags.output === "json") {
          this.render.json(print, { ...found, areas });
          return;
        }

        this.render.entity(print, {
          fields: [
            ["Project", found.slug],
            ["Title", found.title],
            ["Id", found.id],
            ["Rank", found.rank?.name],
            ["Members", found.memberCount],
            [
              "Capabilities",
              found.capabilities.map((capability) => capability.key).join(", "),
            ],
          ],
          sections: [
            {
              title: "Permissions",
              lines: [found.permissions.join(", ") || "(none)"],
            },
            {
              title: "Areas",
              lines: areas.length
                ? areas.map(
                    (area) =>
                      `${area.name}  (${area.openQuestCount} open of ${area.questCount})`,
                  )
                : ["(none)"],
            },
            {
              title: "Your quests in progress",
              lines: found.quests.length
                ? found.quests.map(
                    (quest) => `Q${quest.shortId}  ${quest.title}`,
                  )
                : ["(none)"],
            },
          ],
        });
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `project` would shadow this one
   * silently.
   */
  public readonly project = $command({
    name: "project",
    description: "The projects you belong to: list them, or look at one",
    children: [this.list, this.info],
    handler: async ({ help }) => {
      help();
    },
  });
}

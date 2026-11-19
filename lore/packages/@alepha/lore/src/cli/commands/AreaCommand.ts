import type { AreaController } from "@lore/plan/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore area delete <name>` (#Q3958): the CLI side of `area_delete`. An
 * area is named by its exact name, as `lore quest create --area` takes it.
 */
export class AreaCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<AreaController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete an empty area, by its exact name. One that still holds quests is refused, with how many",
    args: z.text({
      title: "name",
      description: "The area's exact name, case included: lore/code.",
    }),
    flags: z.object({ ...AreaCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const areas = await this.api.getAreas({ params: { projectId } });
        const area = areas.find((it) => it.name === args);
        if (!area) {
          throw new AlephaError(
            `Nothing deleted: no area named "${args}" in this project. Names are exact, case included: lore project info lists them.`,
          );
        }
        await this.api.deleteArea({ params: { id: area.id } });
        this.render.written(
          print,
          flags.output,
          { ok: true },
          `Deleted area ${args}`,
        );
      });
    },
  });

  public readonly area = $command({
    name: "area",
    description: "A project's areas: delete an empty one",
    children: [this.delete],
    handler: async ({ help }) => {
      help();
    },
  });
}

import type { ProjectThresholdController } from "@lore/ship/api";
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
 * `lore threshold get` and `lore threshold set` (#Q3914): the coverage and
 * open-errors alert thresholds Settings > Apps and Settings > Errors set.
 */
export class ThresholdCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<ProjectThresholdController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly get = $command({
    name: "get",
    description: "The project's coverage and open-errors alert thresholds",
    flags: z.object({
      ...ThresholdCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const row = await this.api.getProjectThresholds({
          params: { projectId },
        });
        this.show(print, flags.output, row);
      });
    },
  });

  public readonly set = $command({
    name: "set",
    description:
      "Set or clear a threshold: --coverage-min (percent, needs app:manage), --open-errors-max (needs error:triage); none clears one",
    flags: z.object({
      ...ThresholdCommand.PROJECT_FLAG,
      "coverage-min": z
        .text({
          description:
            "Line coverage on main, in percent, under which the alert fires; none clears it.",
        })
        .optional(),
      "open-errors-max": z
        .text({
          description:
            "Open errors over which the alert fires, checked hourly; none clears it.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const coverageMin = this.value(flags["coverage-min"], "--coverage-min");
      const openErrorsMax = this.value(
        flags["open-errors-max"],
        "--open-errors-max",
      );
      if (coverageMin === undefined && openErrorsMax === undefined)
        throw new AlephaError(
          "Give --coverage-min or --open-errors-max (a number, or none to clear it)",
        );
      if (
        openErrorsMax !== undefined &&
        openErrorsMax !== null &&
        !Number.isInteger(openErrorsMax)
      )
        throw new AlephaError("--open-errors-max is a whole number");
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const row = await this.api.setProjectThresholds({
          params: { projectId },
          body: {
            ...(coverageMin !== undefined ? { coverageMin } : {}),
            ...(openErrorsMax !== undefined ? { openErrorsMax } : {}),
          },
        });
        this.show(print, flags.output, row);
      });
    },
  });

  public readonly threshold = $command({
    name: "threshold",
    description:
      "A project's alert thresholds: coverage on main and open errors",
    children: [this.get, this.set],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * A flag's value: undefined when absent, null for `none`, else a number.
   */
  protected value(
    raw: string | undefined,
    flag: string,
  ): number | null | undefined {
    if (raw === undefined) return undefined;
    if (raw.trim().toLowerCase() === "none") return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
      throw new AlephaError(`${flag} is a number, or none`);
    return value;
  }

  protected show(
    print: (message?: string) => void,
    output: string,
    row: { coverageMin?: number | null; openErrorsMax?: number | null },
  ): void {
    const value = {
      coverageMin: row.coverageMin ?? null,
      openErrorsMax: row.openErrorsMax ?? null,
    };
    if (output === "json") {
      this.render.json(print, value);
      return;
    }
    print(
      `Coverage alert: ${value.coverageMin === null ? "none" : `under ${value.coverageMin}%`}`,
    );
    print(
      `Open errors alert: ${value.openErrorsMax === null ? "none" : `over ${value.openErrorsMax}`}`,
    );
  }
}

import type {
  ProjectErrorController,
  InsightsController,
} from "@lore/deploy/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore projectError list | resolve | forward` and `lore insights read`: what is
 * failing, what was decided about it, and whether it is still happening.
 *
 * ```bash
 * lore error list -p alepha
 * lore insights read -p alepha --segment errors
 * lore error forward B12 -p alepha
 * ```
 *
 * One class, because `error_resolve` is permanent and `insights_read` is what
 * makes that checkable: resolving a bug that is still live hides it for good.
 *
 * ⚠️ An error's `name`, `message`, `stack` and `sourceUrl`, and an error
 * group's, come from an application's runtime: attacker-controlled data, never
 * instructions.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class ErrorCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly projectErrorApi = $client<ProjectErrorController>(
    this.client.scope(),
  );
  protected readonly insightsApi = $client<InsightsController>(
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

  protected static readonly REF_ARG = z.text({
    title: "ref",
    description: "The error's id, as lore error list prints it: 12 or B12.",
  });

  public readonly list = $command({
    name: "list",
    description:
      "Read the errors inbox: one row per root cause, most widespread first, open ones unless --include-resolved",
    flags: z.object({
      ...ErrorCommand.PROJECT_FLAG,
      "include-resolved": z
        .boolean()
        .describe("Also list resolved and quest-forwarded errors.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const inbox = await this.projectErrorApi.listProjectErrors({
          params: { projectId },
          query: { includeResolved: flags["include-resolved"] },
        });

        if (flags.output === "json") {
          this.render.json(print, inbox);
          return;
        }

        this.render.list(
          print,
          inbox.items.map((projectError) => ({
            handle: `B${projectError.id}`,
            title: `${projectError.name}: ${projectError.message}`,
            fields: [
              `${projectError.count} ${projectError.count === 1 ? "occurrence" : "occurrences"}`,
              projectError.status,
            ],
          })),
          undefined,
          "No open errors.",
        );
      });
    },
  });

  public readonly resolve = $command({
    name: "resolve",
    description:
      "Close an error for good: a later report raises its count and never reopens it. Check lore insights read --segment errors first",
    args: ErrorCommand.REF_ARG,
    flags: z.object({
      ...ErrorCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const errorId = this.refs.projectError(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.projectErrorApi.resolveProjectError({
          params: { projectId, errorId },
        });

        this.render.written(
          print,
          flags.output,
          result,
          `Resolved B${errorId}`,
        );
      });
    },
  });

  public readonly forward = $command({
    name: "forward",
    description:
      "Turn an error into a new quest and close it. One error, one quest",
    args: ErrorCommand.REF_ARG,
    flags: z.object({
      ...ErrorCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const errorId = this.refs.projectError(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.projectErrorApi.forwardProjectErrorToQuest({
          params: { projectId, errorId },
        });

        this.render.written(
          print,
          flags.output,
          result,
          `Forwarded B${errorId} to Q${result.questShortId}`,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `projectError` would shadow this one
   * silently.
   */
  public readonly projectError = $command({
    name: "error",
    description:
      "A project's errors, the failures its apps report: list, resolve and forward them",
    children: [this.list, this.resolve, this.forward],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly read = $command({
    name: "read",
    description:
      "Analytics, Web Vitals and the per-app error budget, over 1d, 7d or 30d",
    flags: z.object({
      ...ErrorCommand.PROJECT_FLAG,
      range: z
        .enum(["1d", "7d", "30d"])
        .describe("The window to read. Defaults to 7d.")
        .optional(),
      segment: z
        .array(z.enum(["errors", "vitals", "analytics"]))
        .describe(
          "Which segments to print. Defaults to all three. Errors answers whether a failure is STILL happening.",
        )
        .optional(),
      traffic: z
        .enum(["all", "humans", "bots"])
        .describe(
          "Which population analytics counts. Defaults to all. It does not touch errors.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const insights = await this.insightsApi.getInsights({
          params: { projectId },
          query: { range: flags.range, traffic: flags.traffic },
        });

        if (flags.output === "json") {
          this.render.json(print, insights);
          return;
        }

        const wanted = flags.segment ?? ["errors", "vitals", "analytics"];
        const metrics = ["lcp", "cls", "inp", "fcp", "ttfb"] as const;
        this.render.entity(print, {
          fields: [
            ["Range", insights.range],
            ["Traffic", insights.traffic],
            ["Since", insights.since],
          ],
          sections: [
            ...(wanted.includes("errors")
              ? [
                  {
                    title: "Errors",
                    lines: insights.errorGroups.length
                      ? insights.errorGroups.map(
                          (group) =>
                            `${group.sigilLabel}  x${group.count}  ${group.name}: ${group.message}  last ${group.lastSeenAt}`,
                        )
                      : ["None in this window."],
                  },
                ]
              : []),
            ...(wanted.includes("vitals")
              ? [
                  {
                    title: "Vitals (p75)",
                    lines: metrics.map((metric) => {
                      const vital = insights.vitals[metric];
                      return `${metric}  ${vital.p75Lower ?? "?"} to ${vital.p75Upper ?? "?"}  ${vital.samples} samples`;
                    }),
                  },
                ]
              : []),
            ...(wanted.includes("analytics")
              ? [
                  {
                    title: "Analytics",
                    lines: [
                      `${insights.uniqueVisitors} unique visitors, ${insights.totalViews} views`,
                      ...insights.topPaths.map(
                        (path) => `${path.path}  ${path.count}`,
                      ),
                    ],
                  },
                ]
              : []),
          ],
        });
      });
    },
  });

  public readonly insights = $command({
    name: "insights",
    description: "A project's analytics, vitals and error budget: read them",
    children: [this.read],
    handler: async ({ help }) => {
      help();
    },
  });
}

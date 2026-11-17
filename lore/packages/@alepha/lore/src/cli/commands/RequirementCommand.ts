import type { RequirementController } from "@lore/plan-requirements/api";
import type { ReleaseController } from "@lore/plan/api";
import type { FolioController } from "@lore/remember/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
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
 * `lore requirement list | get | create | update | delete | set release`,
 * and `lore criterion link`: the requirements of Plan's Requirements
 * (#E153), one command per MCP tool.
 *
 * ```bash
 * lore requirement create -p acme --statement "Codes expire" --type functional --priority must
 * lore requirement set release S15 --release 2.4.0 --confirm
 * lore criterion link --usecase U7 --key C2 --requirement S15
 * ```
 *
 * ⚠️ Never re-exported from `index.ts`.
 */
export class RequirementCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  protected readonly requirementApi = $client<RequirementController>(
    this.client.scope(),
  );
  protected readonly releaseApi = $client<ReleaseController>(
    this.client.scope(),
  );
  protected readonly folioApi = $client<FolioController>(this.client.scope());

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
    description:
      "The requirement: 15, S15 or '#S15'. Quote #S15: unquoted, a shell reads # as a comment.",
  });

  protected static readonly TYPE = z
    .enum(["functional", "non_functional", "constraint"])
    .describe("functional, non_functional or constraint.");

  protected static readonly PRIORITY = z
    .enum(["must", "should", "could", "wont"])
    .describe("MoSCoW: must, should, could or wont.");

  protected static readonly FIELDS = {
    description: z
      .text({
        size: "rich",
        atFile: true,
        description: "More detail, in Markdown.",
      })
      .optional(),
    type: RequirementCommand.TYPE.optional(),
    priority: RequirementCommand.PRIORITY.optional(),
    chapter: z
      .text({ description: "The chapter: '3. Promotions'." })
      .optional(),
    paragraph: z.text({ description: "Its paragraph: 3.2." }).optional(),
    "source-folio": z
      .text({ description: "The folio it comes from: 12 or F12." })
      .optional(),
    "source-anchor": z
      .text({ description: "The heading slug of its section in that folio." })
      .optional(),
    "metric-kind": z
      .enum(["vital", "availability", "latency"])
      .describe(
        "Verify it by a measure: a web vital, or a monitor's availability or latency. Needs an app built with Alepha.",
      )
      .optional(),
    "metric-vital": z
      .enum(["lcp", "inp", "cls"])
      .describe("The web vital, for --metric-kind vital.")
      .optional(),
    "metric-percentile": z
      .integer()
      .min(1)
      .max(99)
      .describe("The percentile: 75 for a vital, 95 for a latency by default.")
      .optional(),
    "metric-path": z
      .text({
        description: "A path pattern of the sigil, * matching anything.",
      })
      .optional(),
    "metric-monitor": z
      .text({ description: "The monitor's id; else the copy's first monitor." })
      .optional(),
    "metric-app": z.text({ description: "The app copy's app." }).optional(),
    "metric-env": z
      .text({ description: "The app copy's env: production by default." })
      .optional(),
    "metric-threshold": z
      .number()
      .describe(
        "Met at or below it (ms, a CLS score), or at or above it for availability (a percentage).",
      )
      .optional(),
    "metric-window-days": z
      .integer()
      .min(1)
      .max(90)
      .describe("The window in days: 7 by default.")
      .optional(),
    "metric-clear": z
      .boolean()
      .describe("Remove the metric: use cases verify it again.")
      .optional(),
  };

  protected async bodyOf(
    projectId: number,
    flags: Record<string, unknown>,
    current?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const text = (key: string) =>
      typeof flags[key] === "string" ? (flags[key] as string) : undefined;
    const body: Record<string, unknown> = {};
    for (const [flag, field] of [
      ["description", "description"],
      ["type", "type"],
      ["priority", "priority"],
      ["chapter", "chapter"],
      ["paragraph", "paragraph"],
      ["source-anchor", "sourceAnchor"],
    ] as const) {
      if (text(flag) !== undefined) body[field] = text(flag);
    }
    if (text("source-folio") !== undefined) {
      const folio = await this.folioApi.getByShortId({
        params: { projectId, shortId: this.refs.folio(text("source-folio")!) },
        query: {},
      });
      body.sourceFolioId = folio.id;
    }
    const metric = Object.fromEntries(
      (
        [
          ["metric-kind", "kind"],
          ["metric-vital", "vital"],
          ["metric-percentile", "percentile"],
          ["metric-path", "path"],
          ["metric-monitor", "monitorId"],
          ["metric-app", "app"],
          ["metric-env", "env"],
          ["metric-threshold", "threshold"],
          ["metric-window-days", "windowDays"],
        ] as const
      )
        .filter(([flag]) => flags[flag] !== undefined)
        .map(([flag, field]) => [field, flags[flag]]),
    );
    if (flags["metric-clear"]) {
      body.metric = null;
    } else if (Object.keys(metric).length) {
      const merged = { ...current, ...metric };
      if (!merged.kind || merged.threshold === undefined) {
        throw new UsageError(
          "A metric needs --metric-kind and --metric-threshold",
        );
      }
      body.metric = merged;
    }
    return body;
  }

  public readonly list = $command({
    name: "list",
    description: "List a project's requirements",
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      type: RequirementCommand.TYPE.optional(),
      priority: RequirementCommand.PRIORITY.optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const rows = await this.requirementApi.getRequirements({
          params: { projectId },
          query: {
            ...(flags.type ? { type: flags.type } : {}),
            ...(flags.priority ? { priority: flags.priority } : {}),
          },
        });
        if (flags.output === "json") {
          this.render.json(print, rows);
          return;
        }
        this.render.list(
          print,
          rows.map((it) => ({
            handle: `S${it.number}`,
            title: `${it.paragraph ? `§${it.paragraph} ` : ""}${it.statement}`,
            fields: [it.priority, it.status],
          })),
          undefined,
          "This project has no requirements.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one requirement: its criteria, covering epics, release and status",
    args: RequirementCommand.REF_ARG,
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.requirement(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const it = await this.requirementApi.getRequirementByNumber({
          params: { projectId, number },
        });
        if (flags.output === "json") {
          this.render.json(print, it);
          return;
        }
        this.render.entity(print, {
          fields: [
            ["requirement", `S${it.number} ${it.statement}`],
            ["type", `${it.type} · ${it.priority}`],
            ["paragraph", it.paragraph ? `§${it.paragraph}` : undefined],
            ["chapter", it.chapter],
            ["status", it.status],
            [
              "metric",
              it.metric
                ? `${it.metric.kind} ${it.metric.vital ?? it.metric.monitorId ?? ""} ${it.metric.kind === "availability" ? ">=" : "<="} ${it.metric.threshold}: ${it.metricValue ?? "no data"}${it.metricStatusSince ? ` since ${it.metricStatusSince}` : ""}`
                : undefined,
            ],
            [
              "release",
              it.targetRelease
                ? `${it.targetRelease.tag ?? it.targetRelease.number} (${it.targetRelease.mode === "auto" ? "auto" : "by hand"})`
                : undefined,
            ],
            [
              "covered by",
              it.coveringEpics.map((e) => `E${e.number}`).join(", "),
            ],
            [
              "personas",
              it.personas.map((p) => `A${p.number} ${p.name}`).join(", "),
            ],
          ],
          body: it.description || undefined,
          sections: [
            {
              title: "Verified by",
              lines: it.criteria.map(
                (c) => `U${c.useCaseNumber} ${c.key}  ${c.summary}`,
              ),
            },
          ].filter((section) => section.lines.length > 0),
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description: "Create a requirement, numbered S<n>",
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      statement: z.text({
        minLength: 3,
        maxLength: 240,
        description: "The requirement, in one sentence.",
      }),
      ...RequirementCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const created = await this.requirementApi.createRequirement({
          params: { projectId },
          body: {
            ...(await this.bodyOf(projectId, flags)),
            statement: flags.statement,
          } as never,
        });
        this.render.written(
          print,
          flags.output,
          created,
          `Created S${created.number} ${created.statement}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description: "Change a requirement; omitted flags stay as they are",
    args: RequirementCommand.REF_ARG,
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      statement: z
        .text({ minLength: 3, maxLength: 240, description: "A new statement." })
        .optional(),
      ...RequirementCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.requirement(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const row = await this.requirementApi.getRequirementByNumber({
          params: { projectId, number },
        });
        const body = await this.bodyOf(
          projectId,
          flags,
          (row as { metric?: Record<string, unknown> }).metric,
        );
        if (flags.statement) body.statement = flags.statement;
        const updated = await this.requirementApi.updateRequirement({
          params: { id: row.id },
          body: body as never,
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Updated S${updated.number} ${updated.statement}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a requirement; its number is never reused",
    args: RequirementCommand.REF_ARG,
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe(
          "Required: deleting a requirement cannot be undone from here.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.requirement(args);
        if (!flags.yes) {
          throw new UsageError(
            `Deleting S${number} cannot be undone from here: pass --yes.`,
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);
        const row = await this.requirementApi.getRequirementByNumber({
          params: { projectId, number },
        });
        await this.requirementApi.deleteRequirement({ params: { id: row.id } });
        this.render.written(
          print,
          flags.output,
          { ok: true, number },
          `Deleted S${number} ${row.statement}`,
        );
      });
    },
  });

  public readonly setRelease = $command({
    name: "release",
    description:
      "Set the release a requirement ships in; with covering epics, every one of them moves (pass --confirm when Lore asks)",
    args: RequirementCommand.REF_ARG,
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      release: z.text({
        description:
          "The release's tag: 2.4.0. An empty string clears a release set by hand.",
      }),
      confirm: z
        .boolean()
        .describe(
          "Move the epics even when they cover other requirements or sit in another release.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.requirement(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const row = await this.requirementApi.getRequirementByNumber({
          params: { projectId, number },
        });
        let releaseId: number | null = null;
        if (flags.release) {
          const found = (
            await this.releaseApi.getReleases({ params: { projectId } })
          ).find((it) => it.tag === flags.release);
          if (!found)
            throw new UsageError(
              `No release '${flags.release}' in this project.`,
            );
          releaseId = found.id;
        }
        const result = await this.requirementApi.setRequirementRelease({
          params: { id: row.id },
          body: { releaseId, confirm: flags.confirm },
        });
        if (flags.output === "json") {
          this.render.json(print, result);
          return;
        }
        if (!result.applied) {
          print(`Nothing changed. Setting it moves:`);
          for (const move of result.moves) {
            print(
              `  E${move.epicNumber} ${move.epicTitle}${move.alsoCovers.length ? ` (also covers ${move.alsoCovers.map((n) => `S${n}`).join(", ")})` : ""}`,
            );
          }
          print("Run it again with --confirm to move them.");
          return;
        }
        print(
          `S${number} ships in ${flags.release || "no release"}${result.moves.length ? `; moved ${result.moves.map((m) => `E${m.epicNumber}`).join(", ")}` : ""}`,
        );
      });
    },
  });

  public readonly set = $command({
    name: "set",
    description: "Set a requirement's release",
    children: [this.setRelease],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * ⚠️ Declared after its children: `CliProvider.findCommand` resolves by
   * `findLast`.
   */
  public readonly requirement = $command({
    name: "requirement",
    description:
      "A project's requirements, the lines of its specification: list, read, create, update, delete and set their release",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.delete,
      this.set,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly criterionLink = $command({
    name: "link",
    description:
      "Say which requirement a use case's criterion verifies, or none with --requirement ''",
    flags: z.object({
      ...RequirementCommand.PROJECT_FLAG,
      usecase: z.text({ description: "The use case: 7 or U7." }),
      key: z.text({ description: "The criterion's key: C2." }),
      requirement: z.text({
        description: "The requirement it verifies: 15 or S15. Empty to unlink.",
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const useCaseNumber = this.refs.useCase(flags.usecase);
        const { projectId } = await this.projects.named(flags.project, context);
        const requirementNumber = flags.requirement
          ? this.refs.requirement(flags.requirement)
          : null;
        const result = await this.requirementApi.linkCriterion({
          params: { projectId },
          body: { useCaseNumber, criterionKey: flags.key, requirementNumber },
        });
        this.render.written(
          print,
          flags.output,
          result,
          requirementNumber
            ? `U${useCaseNumber} ${flags.key} verifies S${requirementNumber}`
            : `U${useCaseNumber} ${flags.key} verifies nothing`,
        );
      });
    },
  });

  public readonly criterion = $command({
    name: "criterion",
    description:
      "A use case's acceptance criteria: link one to the requirement it verifies",
    children: [this.criterionLink],
    handler: async ({ help }) => {
      help();
    },
  });
}

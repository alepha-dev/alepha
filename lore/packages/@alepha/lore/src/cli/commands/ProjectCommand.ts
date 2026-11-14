import type {
  ProjectCapabilityController,
  ProjectController,
  ProjectMergeController,
  ProjectReportController,
} from "@lore/core/api";
import type { AppController } from "@lore/deploy/api";
import type { FolioController } from "@lore/knowledge/api";
import type { AreaController } from "@lore/work/api";
import type { EpicController } from "@lore/work/api";
import type { ReleaseController } from "@lore/work/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectLink } from "../services/LoreProjectLink.ts";
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
  protected readonly link = $inject(LoreProjectLink);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly projectApi = $client<ProjectController>(
    this.client.scope(),
  );
  protected readonly areaApi = $client<AreaController>(this.client.scope());
  protected readonly epicApi = $client<EpicController>(this.client.scope());
  protected readonly releaseApi = $client<ReleaseController>(
    this.client.scope(),
  );
  protected readonly folioApi = $client<FolioController>(this.client.scope());
  protected readonly mergeApi = $client<ProjectMergeController>(
    this.client.scope(),
  );
  protected readonly reportApi = $client<ProjectReportController>(
    this.client.scope(),
  );
  protected readonly appApi = $client<AppController>(this.client.scope());
  protected readonly capabilityApi = $client<ProjectCapabilityController>(
    this.client.scope(),
  );

  protected readonly capabilityProjectFlag = z
    .text({
      aliases: ["p"],
      description: "The project, by slug or id. Defaults to LORE_PROJECT.",
    })
    .optional();

  /**
   * `lore project capability list | enable | disable` (#Q3141), over the
   * action the Capabilities settings page uses. Keys and option names come
   * from the server's registry (`listCapabilities`), never from a list here.
   */
  public readonly capabilityList = $command({
    name: "list",
    description:
      "Every capability, whether this project has it on, and its options",
    flags: z.object({
      project: this.capabilityProjectFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.capabilityApi.listCapabilities({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }
        for (const capability of items) {
          print(
            `${capability.enabled ? "[x]" : "[ ]"} ${capability.key.padEnd(10)} ${capability.name}`,
          );
          for (const option of capability.options) {
            print(`      ${option.enabled ? "on " : "off"} ${option.key}`);
          }
        }
      });
    },
  });

  public readonly capabilityEnable = $command({
    name: "enable",
    description:
      "Turn a capability on, or change its options; options not named keep their value",
    args: z.text({ title: "key", description: "The capability, such as apps" }),
    flags: z.object({
      project: this.capabilityProjectFlag,
      option: z
        .array(z.text())
        .describe(
          "An option to set, as name (on) or name=false. Repeat for several.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.capabilityApi.listCapabilities({
          params: { projectId },
        });
        const capability = items.find((it) => it.key === args);
        if (!capability) {
          throw new UsageError(
            `No capability called ${args}. There are: ${items.map((it) => it.key).join(", ")}.`,
          );
        }
        // `setCapability` takes the options WHOLE: start from what is on now,
        // or enabling `track` would turn `deploy` off as a side effect.
        const options: Record<string, boolean> = Object.fromEntries(
          capability.options.map((option) => [option.key, option.enabled]),
        );
        for (const raw of flags.option ?? []) {
          const [name, value, ...rest] = raw.split("=");
          if (
            rest.length > 0 ||
            (value !== undefined && value !== "true" && value !== "false")
          ) {
            throw new UsageError(
              `--option ${raw}: write name (on) or name=false.`,
            );
          }
          if (!capability.options.some((option) => option.key === name)) {
            throw new UsageError(
              `${args} has no option ${name}. Its options: ${capability.options.map((option) => option.key).join(", ") || "none"}.`,
            );
          }
          options[name] = value !== "false";
        }
        const updated = await this.capabilityApi.setCapability({
          params: { projectId, key: capability.key as never },
          body: { enabled: true, options },
        });
        const on = Object.entries(options)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name);
        this.render.written(
          print,
          flags.output,
          updated,
          `Enabled ${capability.key}${capability.options.length ? `: ${on.join(", ") || "no option on"}` : ""}`,
        );
      });
    },
  });

  public readonly capabilityDisable = $command({
    name: "disable",
    description: "Turn a capability off",
    args: z.text({ title: "key", description: "The capability, such as apps" }),
    flags: z.object({
      project: this.capabilityProjectFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const updated = await this.capabilityApi.setCapability({
          params: { projectId, key: args as never },
          body: { enabled: false },
        });
        this.render.written(print, flags.output, updated, `Disabled ${args}`);
      });
    },
  });

  public readonly capability = $command({
    name: "capability",
    description:
      "A project's capabilities and their options: list them, enable one, disable one",
    children: [
      this.capabilityList,
      this.capabilityEnable,
      this.capabilityDisable,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

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
   * `lore project report [section]`: what `project_report` answers, as JSON
   * whatever `--output` says, since a report has no line to print.
   */
  public readonly report = $command({
    name: "report",
    description:
      "Print a Reports section as JSON: summary, flow, backlog, planning, support, knowledge, delivery or team",
    args: z
      .text({
        title: "section",
        description: "The section, summary by default",
      })
      .optional(),
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      days: z
        .integer()
        .describe("The period: the last N days, 30 by default")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const now = this.dt.now();
        const report = await this.reportApi.getProjectReport({
          params: { id: projectId, section: args ?? "summary" },
          query: {
            from: now.subtract(flags.days ?? 30, "day").toISOString(),
            to: now.toISOString(),
          },
        });
        this.render.json(print, report);
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `project` would shadow this one
   * silently.
   */
  /**
   * `lore project create <slug>`: a project with Apps and deploys on, and the
   * current directory linked to it (`.alepha/lore.json`), so every later
   * command here finds it with no flag (#Q2698).
   */
  public readonly create = $command({
    name: "create",
    description:
      "Create a project and link this directory to it (.alepha/lore.json)",
    args: z.text({
      title: "name",
      description: "The project's name; its slug is derived from it",
    }),
    flags: z.object({
      "no-link": z
        .boolean()
        .describe("Create the project without writing .alepha/lore.json")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      await this.refusals.guard({}, async () => {
        const created = await this.projectApi.createProject({
          body: {
            title: args,
            capabilities: [{ key: "apps", options: { deploy: true } }],
          },
        });
        const path = flags["no-link"]
          ? undefined
          : await this.link.write(
              process.cwd(),
              created.slug ?? String(created.id),
            );
        if (flags.output === "json") {
          this.render.json(print, {
            id: created.id,
            slug: created.slug,
            linked: path,
          });
          return;
        }
        print(`Created ${created.slug} (id ${created.id})`);
        if (path) {
          print(`Linked this directory: ${path}`);
        }
      });
    },
  });

  /**
   * `lore project link <slug>`: links the current directory to an existing
   * project, after checking the project exists and is readable.
   */
  public readonly linkProject = $command({
    name: "link",
    description:
      "Link this directory to an existing project (.alepha/lore.json)",
    args: z.text({ title: "project", description: "The project, by slug" }),
    flags: z.object({
      force: z
        .boolean()
        .describe("Replace a link to another project")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = { project: args };
      await this.refusals.guard(context, async () => {
        await this.projects.resolve(args);
        const path = await this.link.write(
          process.cwd(),
          args,
          flags.force ?? false,
        );
        print(`Linked this directory to ${args}: ${path}`);
      });
    },
  });

  /**
   * `lore project context`: what `project_context` gives an agent, from the
   * actions behind it. A section whose capability is off is not read, and
   * stays absent from `--output json`.
   */
  public readonly context = $command({
    name: "context",
    description:
      "Orient yourself in a project: areas, your quests, open epics, releases, the folio index and pinned folios",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      "all-epics": z
        .boolean()
        .describe("List the completed epics too, in the human output.")
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(200)
        .describe("How many folios to index, at most 200. Defaults to 30.")
        .default(30),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const found = await this.projectApi.getProjectById({
          params: { id: projectId },
        });
        const enabled = new Set(
          found.capabilities.map((capability) => capability.key),
        );
        const params = { projectId };

        const work = enabled.has("work")
          ? {
              areas: await this.areaApi.getAreas({ params }),
              epics: await this.epicApi.getEpics({ params }),
              openReleases: await this.releaseApi.getOpenReleaseProgress({
                params,
              }),
            }
          : {};
        const folios = enabled.has("knowledge")
          ? await this.folioApi.index({
              params,
              query: { limit: flags.limit, pinnedContent: true },
            })
          : undefined;

        if (flags.output === "json") {
          this.render.json(print, {
            ...found,
            ...work,
            ...(folios ? { folios } : {}),
          });
          return;
        }

        const pinned = (folios ?? []).filter(
          (folio) => folio.pinned && !folio.protected && folio.content,
        );
        const epics = (work.epics ?? []).filter(
          (epic) => flags["all-epics"] || epic.status !== "completed",
        );
        this.render.entity(print, {
          fields: [
            ["Project", found.slug],
            ["Title", found.title],
            ["Id", found.id],
            ["Rank", found.rank?.name],
            ["Language", found.preferredLanguage],
            [
              "Capabilities",
              found.capabilities.map((capability) => capability.key).join(", "),
            ],
          ],
          sections: [
            ...(work.areas
              ? [
                  {
                    title: "Areas",
                    lines: work.areas.map((area) =>
                      area.description
                        ? `${area.name}  ${area.description}`
                        : area.name,
                    ),
                  },
                  {
                    title: "Your quests in progress",
                    lines: found.quests.length
                      ? found.quests.map(
                          (quest) => `Q${quest.shortId}  ${quest.title}`,
                        )
                      : ["(none)"],
                  },
                  {
                    title: "Epics",
                    lines: epics.length
                      ? epics.map(
                          (epic) =>
                            `E${epic.number}  ${epic.title}  ${epic.status}  ${epic.progress.completed}/${epic.questCount}`,
                        )
                      : ["(none)"],
                  },
                  {
                    title: "Open releases",
                    lines: work.openReleases?.length
                      ? work.openReleases.map(
                          (release) =>
                            `${release.tag}  ${release.completed}/${release.total}${release.defaultSince ? "  default" : ""}`,
                        )
                      : ["(none)"],
                  },
                ]
              : []),
            ...(folios
              ? [
                  {
                    title: "Folios",
                    lines: folios.length
                      ? folios.map((folio) =>
                          folio.summary?.trim()
                            ? `F${folio.shortId}  ${folio.title}: ${folio.summary}`
                            : `F${folio.shortId}  ${folio.title}`,
                        )
                      : ["(none)"],
                  },
                ]
              : []),
            ...pinned.map((folio) => ({
              title: `Pinned: F${folio.shortId} ${folio.title}`,
              lines: [folio.content ?? ""],
            })),
          ],
        });
      });
    },
  });

  /**
   * `lore project activity`, read forward from a stamp like `project_activity`.
   *
   * ⚠️ Unlike the tool it keeps your own events: the tool drops them by the
   * session's user, and no action tells this process who it is.
   */
  public readonly activity = $command({
    name: "activity",
    description:
      "What happened in a project since a timestamp, oldest first; your own events included",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      since: z.datetime().describe("The stamp to read from, exclusive."),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many events to print, at most 100. Defaults to 100.")
        .default(100),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const page = await this.projectApi.getProjectActivity({
          params: { id: projectId },
          query: { after: flags.since, size: flags.limit, sort: "createdAt" },
        });
        // `after` excludes the boundary at the column's precision; this does
        // at the caller's, the millisecond stamp `Next` hands out.
        const events = page.content.filter(
          (event) => event.createdAt > flags.since,
        );

        if (flags.output === "json") {
          this.render.json(print, { ...page, content: events });
          return;
        }

        if (events.length === 0) {
          print("Nothing since then.");
          return;
        }
        for (const event of events) {
          const times =
            (event.eventCount ?? 1) > 1 ? ` x${event.eventCount}` : "";
          const title = event.description ? ` (${event.description})` : "";
          print(
            `${event.createdAt}  ${event.action}${times} ${event.type} ${event.resourceId ?? ""}${title}`,
          );
        }
        print(`Next: --since ${events.at(-1)?.createdAt}`);
      });
    },
  });

  public readonly merge = $command({
    name: "merge",
    description:
      "Merge one project into another. A dry run unless --no-dry-run: read the plan first",
    flags: z.object({
      source: z.text({
        description:
          "The project to merge FROM, by slug or id. It is left empty.",
      }),
      target: z.text({
        description: "The project to merge INTO, by slug or id.",
      }),
      "dry-run": z
        .boolean()
        .describe(
          "Answer the plan and write nothing, the default. --no-dry-run applies it, in one atomic batch.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        context.project = flags.source;
        const source = await this.projects.resolve(flags.source);
        const target = await this.projects.resolve(flags.target);
        const dryRun = flags["dry-run"] !== false;

        const result = await this.mergeApi.mergeProject({
          params: { id: source },
          body: { target, dryRun },
        });

        if (flags.output === "json") {
          this.render.json(print, result);
          return;
        }

        print(
          `${dryRun ? "Plan to merge" : "Merged"} ${flags.source} into ${flags.target}:`,
        );
        for (const step of result.steps) {
          const moved = Object.entries(step.moved)
            .map(([kind, count]) => `${count} ${kind}`)
            .join(", ");
          print(`  ${step.name}: ${moved || "nothing to move"}`);
          for (const conflict of step.conflicts ?? []) {
            print(`  CONFLICT ${conflict.kind} ${conflict.key}`);
          }
        }
        if (dryRun) {
          print("Nothing was written. --no-dry-run applies it.");
        }
      });
    },
  });

  /**
   * `lore project delete <slug> --confirm <slug>` (#Q3154): a scratch project
   * goes away from a shell, through the owner's own delete
   * (`deleteProjectById`, `project:delete`), the one the danger zone calls.
   *
   * ⚠️ The one irreversible delete in the CLI, so no `--yes`: the slug is typed
   * twice, and what goes with it is printed first, as `project merge` shows
   * its plan, whether the confirmation matches or not.
   */
  public readonly delete = $command({
    name: "delete",
    description:
      "Delete a project you own, with everything in it. Prints what goes first; needs --confirm <slug>",
    args: z.text({ title: "project", description: "The project, by slug" }),
    flags: z.object({
      confirm: z
        .text({
          description:
            "The project's slug again. Required: this cannot be undone.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = { project: args };
      await this.refusals.guard(context, async () => {
        const projectId = await this.projects.resolve(args);
        const counts = await this.deletionCounts(projectId);

        if (flags.confirm !== args) {
          this.printDeletionPlan(print, args, counts);
          throw new UsageError(
            flags.confirm === undefined
              ? `Deleting ${args} cannot be undone. Type its slug again to confirm: lore project delete ${args} --confirm ${args}`
              : `--confirm ${flags.confirm} does not match ${args}; nothing was deleted.`,
          );
        }

        await this.projectApi.deleteProjectById({ params: { id: projectId } });
        if (flags.output === "json") {
          this.render.json(print, { ok: true, project: args, ...counts });
          return;
        }
        this.printDeletionPlan(print, args, counts, true);
      });
    },
  });

  public readonly project = $command({
    name: "project",
    description:
      "The projects you belong to: list, look at one, orient yourself, read what moved, read its reports, create one, merge one, delete one, or link this directory to one",
    children: [
      this.list,
      this.info,
      this.context,
      this.activity,
      this.report,
      this.create,
      this.linkProject,
      this.merge,
      this.delete,
      this.capability,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * What deleting a project takes with it, from the reads a member already
   * has: quests summed over its areas (every quest has one), folios from the
   * index (capped at 200, said as `200+`), deployed copies from the Apps
   * list. A read the project's capabilities refuse counts as unknown, never
   * as zero.
   */
  protected async deletionCounts(projectId: number): Promise<{
    quests?: number;
    folios?: number | string;
    apps?: number;
  }> {
    const settle = async <T>(read: () => Promise<T>) => {
      try {
        return await read();
      } catch {
        return undefined;
      }
    };
    const params = { projectId };
    const [areas, folios, apps] = await Promise.all([
      settle(() => this.areaApi.getAreas({ params })),
      settle(() => this.folioApi.index({ params, query: { limit: 200 } })),
      settle(() => this.appApi.listApps({ params })),
    ]);
    return {
      quests: areas?.reduce((sum, area) => sum + area.questCount, 0),
      folios:
        folios === undefined
          ? undefined
          : folios.length >= 200
            ? "200+"
            : folios.length,
      apps: apps?.items.length,
    };
  }

  protected printDeletionPlan(
    print: (line?: string) => void,
    slug: string,
    counts: {
      quests?: number;
      folios?: number | string;
      apps?: number;
    },
    done = false,
  ): void {
    const shown = (value: number | string | undefined) =>
      value === undefined ? "?" : String(value);
    print(
      `${done ? "Deleted" : "Deleting"} ${slug} ${done ? "took" : "takes"} with it: ${shown(counts.quests)} quests, ${shown(counts.folios)} folios, ${shown(counts.apps)} deployed copies (their sigils and telemetry).`,
    );
    if (!done) {
      print(
        "Nothing on a host is stopped: a copy keeps running where it was deployed.",
      );
    }
  }
}

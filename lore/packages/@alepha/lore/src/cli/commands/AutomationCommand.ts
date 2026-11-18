import type {
  ProjectChannelController,
  AutomationController,
} from "@lore/core/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore automation`: a project's rules, their runs, their shared variables and
 * its channels.
 *
 * ```bash
 * lore automation catalog -p alepha
 * lore automation create -p alepha --title "Release note" --graph @graph.json
 * lore automation create -p alepha --title "Hosts" --source host.offline \
 *   --source host.online --action @notify.json
 * lore automation test 0190... -p alepha
 * lore automation update 0190... --enabled --expected-revision 1 -p alepha
 * ```
 *
 * ## ⚠️ An automation is a graph, in a file
 *
 * An automation is a graph of sources, reads, conditions and actions
 * (#Q3809), whose node types `automation catalog` describes. Flags for them
 * would be a second vocabulary, so `--graph` takes the JSON (`nodes` and
 * `edges`) and the server validates it. The compact form is flags: each
 * `--source` an event type or `{ type, config }`, each `--action`
 * `{ type, config }`, every source wired to every action.
 *
 * The server accepts an outline only (#Q3845): blocks of events (or one
 * schedule and its read), at most one condition each, then sequences of
 * actions on each side, with no join and one next action at most.
 *
 * ## ⚠️ `--expected-revision` is the tool's fence, not a detail
 *
 * Every write names the revision it read. A command that read it for the
 * caller would turn the fence off: a rule edited in between would be
 * overwritten by someone who never saw the edit.
 *
 * ## `catalog` and `test` print JSON whatever `--output`
 *
 * Each is one nested document made to be read in full, and a terse render
 * would hide the part that was asked for.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class AutomationCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<AutomationController>(this.client.scope());
  protected readonly channels = $client<ProjectChannelController>(
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

  protected static readonly PAGE_FLAGS = {
    offset: z
      .integer()
      .min(0)
      .describe("Rows to skip, for the next page.")
      .optional(),
    limit: z
      .integer()
      .min(1)
      .max(50)
      .describe("Rows in this page, 1-50.")
      .optional(),
  };

  protected static readonly ID_ARG = z.text({
    title: "id",
    description: "The automation's id, as lore automation list prints it.",
  });

  protected static readonly KEY_ARG = z.text({
    title: "key",
    description: "The variable's key.",
  });

  protected static readonly POLICY_ARG = z
    .enum(["release-notifications"])
    .meta({ title: "policy" });

  protected static readonly GRAPH_FLAGS = {
    graph: z
      .text({
        size: "rich",
        atFile: true,
        description:
          "The whole graph, as JSON: { nodes, edges }. lore automation catalog names the node types it may hold. The graph is an outline of blocks: each block is its events (or one schedule and its read), at most one condition, then independent sequences of actions on the true and false sides of the condition; nothing joins (wire an action on both sides instead), a condition leads to actions only, and an action is followed by one action at most. A node has no position: a graph stores no drawing, and a node given one is refused.",
      })
      .optional(),
    source: z
      .array(z.text())
      .describe(
        "The compact form, with --action: a source, repeatable, as an event type (host.offline) or JSON { type, config }. Every source is wired to every action.",
      )
      .optional(),
    action: z
      .array(z.text({ atFile: true }))
      .describe(
        "The compact form, with --source: an action, repeatable, as JSON { type, config }.",
      )
      .optional(),
  };

  protected static readonly REVISION_FLAG = {
    "expected-revision": z
      .integer()
      .min(0)
      .describe(
        "The revision you read, from lore automation get. A rule changed since is refused rather than overwritten.",
      ),
  };

  public readonly list = $command({
    name: "list",
    description: "List a project's automations",
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.PAGE_FLAGS,
      search: z
        .text({ description: "Only titles containing this." })
        .optional(),
      state: z
        .enum(["disabled", "active", "paused", "broken"])
        .describe("Only rules in this state.")
        .optional(),
      "author-user-id": z
        .uuid()
        .describe("Only this author's rules.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const page = await this.api.listAutomations({
          params: { projectId },
          query: {
            offset: flags.offset,
            limit: flags.limit,
            ...(flags.search === undefined ? {} : { search: flags.search }),
            ...(flags.state === undefined ? {} : { state: flags.state }),
            ...(flags["author-user-id"] === undefined
              ? {}
              : { authorUserId: flags["author-user-id"] }),
          },
        });

        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }

        this.render.list(
          print,
          page.items.map((rule) => ({
            handle: rule.id,
            title: rule.title,
            fields: [rule.displayState, `revision ${rule.revision}`],
          })),
          this.pageOf(page, flags.offset),
          "This project has no automations.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Read an automation: its health, author, revision, last run and rule",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const rule = await this.api.getAutomation({
          params: { projectId, id: args },
        });

        if (flags.output === "json") {
          this.render.json(print, rule);
          return;
        }

        this.render.entity(print, {
          fields: [
            ["Automation", rule.id],
            ["Title", rule.title],
            ["State", rule.displayState],
            ["Revision", rule.revision],
            ["Author", rule.authorName ?? rule.authorUserId],
            ["Reason", rule.reason],
            ["Next run", rule.nextRunAt],
            ["Last run", rule.lastRun?.status],
          ],
          sections: rule.rule
            ? [
                {
                  title: "Sources",
                  lines: (rule.sources ?? []).map(
                    (source) =>
                      `${source.node}: ${source.summary ?? source.type}${source.enabled ? "" : " (off)"}${source.health === "broken" ? ` (broken: ${source.reason})` : ""}`,
                  ),
                },
                {
                  title: "Graph",
                  lines: [JSON.stringify(rule.rule, null, 2)],
                },
              ]
            : [],
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Create an automation as yourself, as a draft, or enabled in the same write with --enabled",
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      title: z.text({ description: "What the automation is for." }),
      ...AutomationCommand.GRAPH_FLAGS,
      enabled: z
        .boolean()
        .describe(
          "Create it enabled, in one write, after the checks enabling runs. Refused, nothing is created.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const graph = this.graphOf(flags);
        if (!graph)
          throw new UsageError(
            "Pass --graph, or --source and --action for the compact form.",
          );
        const { projectId } = await this.projects.named(flags.project, context);

        // One write (#Q3573): enabled or a draft, never a draft left behind
        // a refused enable.
        const created = await this.api.createAutomation({
          params: { projectId },
          body: {
            title: flags.title,
            ...graph,
            ...(flags.enabled ? { enabled: true } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          created,
          `Created ${created.id} ${created.title}, ${created.enabled ? "enabled" : "disabled"}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change an automation: --title with --graph (or --source and --action), or --enabled / --no-enabled alone",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.REVISION_FLAG,
      title: z.text({ description: "A new title." }).optional(),
      ...AutomationCommand.GRAPH_FLAGS,
      enabled: z
        .boolean()
        .describe("Enable the rule, or --no-enabled to stop it and keep it.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const expectedRevision = flags["expected-revision"];
        const graph = this.graphOf(flags);
        const configuring = flags.title !== undefined || graph !== undefined;
        if (flags.enabled === undefined) {
          if (flags.title === undefined || graph === undefined) {
            throw new UsageError(
              "Pass --title with --graph (or --source and --action), or --enabled / --no-enabled alone.",
            );
          }
        } else if (configuring) {
          throw new UsageError(
            "Configuration and enable changes are separate revisioned calls: pass --enabled alone.",
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);
        const params = { projectId, id: args };

        const updated =
          flags.enabled === undefined
            ? await this.api.updateAutomation({
                params,
                body: {
                  expectedRevision,
                  title: flags.title as string,
                  ...graph!,
                },
              })
            : await this.api.setAutomationEnabled({
                params,
                body: { enabled: flags.enabled, expectedRevision },
              });

        this.render.written(
          print,
          flags.output,
          updated,
          `Updated ${updated.id}, now ${updated.displayState} at revision ${updated.revision}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete an automation. To stop one and keep it: lore automation update --no-enabled",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.REVISION_FLAG,
      yes: z
        .boolean()
        .describe("Required: queued effects stop, and the rule is gone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: ${args} would go, with its queued effects. Pass --yes to delete it.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.api.deleteAutomation({
          params: { projectId, id: args },
          body: { expectedRevision: flags["expected-revision"] },
        });

        this.render.written(print, flags.output, result, `Deleted ${args}`);
      });
    },
  });

  public readonly runs = $command({
    name: "runs",
    description: "Read an automation's retained runs, newest first",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.PAGE_FLAGS,
      source: z
        .text({ description: "Only the runs this source node started." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const page = await this.api.listAutomationRuns({
          params: { projectId, id: args },
          query: {
            offset: flags.offset,
            limit: flags.limit,
            ...(flags.source === undefined ? {} : { source: flags.source }),
          },
        });

        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }

        this.render.list(
          print,
          page.items.map((run) => ({
            handle: run.id,
            title: run.status,
            fields: [run.sourceNode, run.triggeredAt, run.reason],
          })),
          this.pageOf(page, flags.offset),
          "No retained runs.",
        );
      });
    },
  });

  public readonly catalog = $command({
    name: "catalog",
    description:
      "What an automation may hold here: node types (sources, reads, conditions, actions) with their ports and outputs, channels, variables and limits",
    flags: z.object({ ...AutomationCommand.PROJECT_FLAG }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        this.render.json(
          print,
          await this.api.getAutomationCatalog({ params: { projectId } }),
        );
      });
    },
  });

  public readonly test = $command({
    name: "test",
    description:
      "Preview a saved automation from one source, with no writes, no delivery and no audit",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      source: z
        .text({
          atFile: true,
          description:
            "What to test against, as JSON: a same-project subject id or a retained event or run id.",
        })
        .optional(),
      node: z
        .text({
          description:
            "The source node to start from, required when the automation has several.",
        })
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const source =
          flags.source === undefined
            ? undefined
            : this.parsed(flags.source, "--source");
        const { projectId } = await this.projects.named(flags.project, context);

        this.render.json(
          print,
          await this.api.testAutomation({
            params: { projectId, id: args },
            body: {
              source: source as any,
              ...(flags.node === undefined ? {} : { node: flags.node }),
            },
          }),
        );
      });
    },
  });

  public readonly variableList = $command({
    name: "list",
    description: "List the project's shared variables",
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.PAGE_FLAGS,
      key: z.text({ description: "Only this exact key." }).optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const page = await this.api.listAutomationVariables({
          params: { projectId },
          query: {
            offset: flags.offset,
            limit: flags.limit,
            ...(flags.key === undefined ? {} : { key: flags.key }),
          },
        });

        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }

        this.render.list(
          print,
          page.items.map((variable) => ({
            handle: variable.key,
            title: variable.id,
            fields: [variable.kind, `version ${variable.version}`],
          })),
          this.pageOf(page, flags.offset),
          "No shared variables.",
        );
      });
    },
  });

  public readonly variableSet = $command({
    name: "set",
    description:
      "Create or change a shared variable. Other authors' rules using it pause for approval",
    args: AutomationCommand.KEY_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      variable: z.text({
        atFile: true,
        description:
          "The typed value as JSON, with the variable's id and version when it already exists.",
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const variable = this.parsed(flags.variable, "--variable");
        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.api.setAutomationVariable({
          params: { projectId, key: args },
          body: variable as any,
        });

        this.render.written(print, flags.output, result, `Set ${args}`);
      });
    },
  });

  public readonly variableDelete = $command({
    name: "delete",
    description: "Delete an unused shared variable",
    args: AutomationCommand.KEY_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      id: z.uuid().describe("The variable's id. It has to match."),
      version: z
        .integer()
        .min(0)
        .describe("The variable's version. It has to match."),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.api.deleteAutomationVariable({
          params: { projectId, key: args },
          body: { id: flags.id, version: flags.version },
        });

        this.render.written(print, flags.output, result, `Deleted ${args}`);
      });
    },
  });

  public readonly variableDependents = $command({
    name: "dependents",
    description: "List the rules using a shared variable",
    args: AutomationCommand.KEY_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.PAGE_FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        this.render.json(
          print,
          await this.api.getAutomationVariableDependents({
            params: { projectId, key: args },
            query: { offset: flags.offset, limit: flags.limit },
          }),
        );
      });
    },
  });

  public readonly channelList = $command({
    name: "list",
    description:
      "List the project's notification channels: their ids, kinds and names, never a webhook URL",
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.channels.listProjectChannels({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }
        this.render.list(
          print,
          page.items.map((channel) => ({
            handle: channel.id,
            title: channel.name,
            fields: [channel.kind],
          })),
          undefined,
          "No channels.",
        );
      });
    },
  });

  public readonly channel = $command({
    name: "channel",
    description:
      "A project's notification channels; they are added in the browser, under Settings > Automations > Channels",
    children: [this.channelList],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly variable = $command({
    name: "variable",
    description:
      "A project's shared variables: list, set, delete them and see who uses them",
    children: [
      this.variableList,
      this.variableSet,
      this.variableDelete,
      this.variableDependents,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly sourceSet = $command({
    name: "set",
    description:
      "Switch one source of an automation off or on: off stops it alone, on asks for its author",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.REVISION_FLAG,
      node: z.text({
        description: "The source node, as lore automation get lists it.",
      }),
      enabled: z
        .boolean()
        .describe("--enabled to switch it on, --no-enabled to switch it off."),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const updated = await this.api.setAutomationSourceEnabled({
          params: { projectId, id: args },
          body: {
            node: flags.node,
            enabled: flags.enabled,
            expectedRevision: flags["expected-revision"],
          },
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Source ${flags.node} of ${updated.id} is ${flags.enabled ? "on" : "off"}, revision ${updated.revision}`,
        );
      });
    },
  });

  public readonly source = $command({
    name: "source",
    description: "One source of an automation: switch it off or on",
    children: [this.sourceSet],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `automation` would shadow this one
   * silently.
   */
  public readonly automation = $command({
    name: "automation",
    description:
      "A project's automations: rules, runs, shared variables and channels",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.delete,
      this.runs,
      this.catalog,
      this.test,
      this.source,
      this.variable,
      this.channel,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The write body the graph flags make: `--graph` as the rule, or the
   * compact `--source` / `--action` as is, expanded by the server.
   */
  protected graphOf(flags: {
    graph?: string;
    source?: string[];
    action?: string[];
  }): Record<string, unknown> | undefined {
    if (flags.graph !== undefined) {
      if (flags.source || flags.action)
        throw new UsageError(
          "Pass --graph, or --source and --action, not both.",
        );
      const graph = this.parsed(flags.graph, "--graph") as Record<
        string,
        unknown
      >;
      return { rule: { version: 2, edges: [], ...graph } };
    }
    if (!flags.source && !flags.action) return undefined;
    if (!flags.source?.length || !flags.action?.length)
      throw new UsageError("The compact form takes --source and --action.");
    return {
      sources: flags.source.map((value) =>
        value.trim().startsWith("{")
          ? this.parsed(value, "--source")
          : { type: value.trim() },
      ),
      actions: flags.action.map((value) => this.parsed(value, "--action")),
    };
  }

  /**
   * A flag holding JSON. Refused here rather than sent, so a typo costs no
   * request and names the flag.
   */
  protected parsed(value: string, flag: string): unknown {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new UsageError(
        `${flag} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * The page line's input: these pages know whether more follows, not how many.
   */
  protected pageOf(
    page: { items: unknown[]; hasMore: boolean },
    offset: number | undefined,
  ) {
    return page.hasMore
      ? { offset: offset ?? 0, limit: page.items.length }
      : undefined;
  }
}

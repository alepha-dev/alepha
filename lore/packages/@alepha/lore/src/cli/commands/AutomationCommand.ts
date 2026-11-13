import type { AutomationController } from "@lore/core/api";
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
 * the adoption of the legacy policies.
 *
 * ```bash
 * lore automation catalog -p alepha
 * lore automation create -p alepha --title "Release note" --rule @rule.json
 * lore automation test 0190... -p alepha
 * lore automation update 0190... --enabled --expected-revision 1 -p alepha
 * ```
 *
 * ## ⚠️ A rule is JSON, in a file
 *
 * A rule is four typed slots, which `automation catalog` describes. Flags for
 * them would be a second vocabulary, so `--rule` takes the JSON the action
 * takes, and the server validates it.
 *
 * ## ⚠️ `--expected-revision` is the tool's fence, not a detail
 *
 * Every write names the revision it read. A command that read it for the
 * caller would turn the fence off: a rule edited in between would be
 * overwritten by someone who never saw the edit.
 *
 * ## `catalog`, `test` and `adoption preview` print JSON whatever `--output`
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
    .enum(["quest-reminders", "release-notifications"])
    .meta({ title: "policy" });

  protected static readonly RULE_FLAG = {
    rule: z.text({
      size: "rich",
      atFile: true,
      description:
        "The whole four-slot rule, as JSON. lore automation catalog names what it may hold.",
    }),
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
                  title: "Rule",
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
      title: z.text({ description: "What the rule is for." }),
      ...AutomationCommand.RULE_FLAG,
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
        const rule = this.parsed(flags.rule, "--rule");
        const { projectId } = await this.projects.named(flags.project, context);

        // One write (#Q3573): enabled or a draft, never a draft left behind
        // a refused enable.
        const created = await this.api.createAutomation({
          params: { projectId },
          body: {
            title: flags.title,
            rule: rule as any,
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
      "Change a rule: --title with --rule, or --enabled / --no-enabled alone",
    args: AutomationCommand.ID_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      ...AutomationCommand.REVISION_FLAG,
      title: z.text({ description: "A new title." }).optional(),
      rule: AutomationCommand.RULE_FLAG.rule.optional(),
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
        const configuring =
          flags.title !== undefined || flags.rule !== undefined;
        if (flags.enabled === undefined) {
          if (flags.title === undefined || flags.rule === undefined) {
            throw new UsageError(
              "Pass --title and --rule together, or --enabled / --no-enabled alone.",
            );
          }
        } else if (configuring) {
          throw new UsageError(
            "Configuration and enable changes are separate revisioned calls: pass --enabled alone.",
          );
        }

        const rule =
          flags.rule === undefined
            ? undefined
            : this.parsed(flags.rule, "--rule");
        const { projectId } = await this.projects.named(flags.project, context);
        const params = { projectId, id: args };

        const updated =
          flags.enabled === undefined
            ? await this.api.updateAutomation({
                params,
                body: {
                  expectedRevision,
                  title: flags.title as string,
                  rule: rule as any,
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
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const page = await this.api.listAutomationRuns({
          params: { projectId, id: args },
          query: { offset: flags.offset, limit: flags.limit },
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
            fields: [run.triggeredAt, run.reason],
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
      "What a rule may say here: events, selections, metrics, actions, channels, variables and limits",
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
      "Preview a saved rule with no writes, no delivery and no audit",
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
            body: { source: source as any },
          }),
        );
      });
    },
  });

  public readonly adoptionPreview = $command({
    name: "preview",
    description:
      "Preview adopting a legacy policy as yourself: state, recipients, grants and cutover. No writes",
    args: AutomationCommand.POLICY_ARG,
    flags: z.object({ ...AutomationCommand.PROJECT_FLAG }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        this.render.json(
          print,
          await this.api.previewAutomationAdoption({
            params: { projectId, policy: args },
          }),
        );
      });
    },
  });

  public readonly adoption = $command({
    name: "adoption",
    description: "Moving a legacy policy onto automations: preview it",
    children: [this.adoptionPreview],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly adopt = $command({
    name: "adopt",
    description:
      "Adopt a legacy policy as its immutable author. The cutover is permanent, so it needs --confirm",
    args: AutomationCommand.POLICY_ARG,
    flags: z.object({
      ...AutomationCommand.PROJECT_FLAG,
      confirm: z
        .boolean()
        .describe("Your explicit consent. Read adoption preview first."),
      "automation-id": z
        .uuid()
        .describe("Adopt your already configured compatible rule.")
        .optional(),
      "expected-revision": z
        .integer()
        .min(0)
        .describe("That rule's revision, with --automation-id.")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        this.render.json(
          print,
          await this.api.adoptAutomationPolicy({
            params: { projectId, policy: args },
            body: {
              confirm: flags.confirm,
              automationId: flags["automation-id"],
              expectedRevision: flags["expected-revision"],
            } as any,
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

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `automation` would shadow this one
   * silently.
   */
  public readonly automation = $command({
    name: "automation",
    description:
      "A project's automations: rules, runs, shared variables and policy adoption",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.delete,
      this.runs,
      this.catalog,
      this.test,
      this.adoption,
      this.adopt,
      this.variable,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

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

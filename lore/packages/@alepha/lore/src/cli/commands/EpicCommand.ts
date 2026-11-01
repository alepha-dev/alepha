import type { EpicController } from "@lore/work/api";
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
 * `lore epic list | get | create | update | set status | shelve | unshelve | delete`.
 *
 * ```bash
 * lore epic create -p alepha --title "Lore CLI parity" --description @plan.md
 * lore epic get E45 -p alepha
 * lore epic set status E45 --status ready -p alepha
 * ```
 *
 * Named from the MCP tools by the one rule: `epic_set_status` is
 * `lore epic set status`. Like every command of the planning surface, each one
 * is existing actions over `$client` (#F1264), so the status rules are the
 * server's and its refusals arrive in its own words.
 *
 * ## ⚠️ `--yes` on delete is a flag, never a prompt
 *
 * `epic delete` takes every quest of the epic with it, and an agent's shell
 * has no stdin to answer a prompt with. So the command refuses without the
 * flag and never asks.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class EpicCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly epicApi = $client<EpicController>(this.client.scope());

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
      "The epic: 45, E45 or '#E45'. Quote #E45: unquoted, a shell reads # as a comment.",
  });

  public readonly list = $command({
    name: "list",
    description: "List every epic of a project, whatever its status",
    flags: z.object({ ...EpicCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const epics = await this.epicApi.getEpics({ params: { projectId } });

        if (flags.output === "json") {
          this.render.json(print, epics);
          return;
        }

        this.render.list(
          print,
          epics.map((epic) => ({
            handle: `E${epic.number}`,
            title: epic.title,
            fields: [
              epic.status,
              `${epic.progress.completed}/${epic.progress.total}`,
            ],
          })),
          undefined,
          "This project has no epics.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one epic: its status, progress, plan and the folios filed under it",
    args: EpicCommand.REF_ARG,
    flags: z.object({ ...EpicCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const epic = await this.epicApi.getEpicDetailByNumber({
          params: { projectId, number },
        });

        if (flags.output === "json") {
          this.render.json(print, epic);
          return;
        }

        const { progress } = epic;
        this.render.entity(print, {
          fields: [
            ["Epic", `E${epic.number}`],
            ["Title", epic.title],
            ["Status", epic.status],
            [
              "Progress",
              `${progress.completed} done, ${progress.inProgress} in progress, ${progress.shelved} shelved, of ${progress.total}`,
            ],
            [
              "After",
              epic.dependsOnNumber
                ? `E${epic.dependsOnNumber} (${epic.dependsOnStatus})`
                : undefined,
            ],
            ["Started", epic.startedAt],
            ["Completed", epic.completedAt],
          ],
          body: epic.description,
          sections: epic.folios.length
            ? [
                {
                  title: "Folios",
                  lines: epic.folios.map(
                    (folio) => `F${folio.shortId}  ${folio.title}`,
                  ),
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
      "Create an epic, as a draft: its quests stay out of the backlog until it is ready",
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      title: z.text({
        minLength: 3,
        maxLength: 80,
        description: "The initiative, in one line.",
      }),
      description: z
        .text({
          size: "rich",
          atFile: true,
          description: "The plan, in Markdown.",
        })
        .optional(),
      "depends-on": z
        .text({
          description:
            "The epic that has to complete first: 45 or E45. No quest of this one can be accepted before it does.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const created = await this.epicApi.createEpic({
          params: { projectId },
          body: {
            title: flags.title,
            description: flags.description,
            dependsOn: await this.dependsOn(projectId, flags["depends-on"]),
          },
        });

        this.render.written(
          print,
          flags.output,
          created,
          `Created E${created.number} ${created.title}, as a draft`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description: "Change an epic's title, plan or predecessor",
    args: EpicCommand.REF_ARG,
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      title: z
        .text({ minLength: 3, maxLength: 80, description: "A new title." })
        .optional(),
      description: z
        .text({
          size: "rich",
          atFile: true,
          description: "A new plan, in Markdown. Replaces the old one.",
        })
        .optional(),
      "depends-on": z
        .text({
          description:
            "The epic that has to complete first, 45 or E45; 0 clears it.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const changed = [
          ...(flags.title !== undefined ? ["title"] : []),
          ...(flags.description !== undefined ? ["description"] : []),
          ...(flags["depends-on"] !== undefined ? ["depends-on"] : []),
        ];
        if (changed.length === 0) {
          throw new UsageError(
            "Nothing to update: pass at least one of --title, --description or --depends-on.",
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const updated = await this.epicApi.updateEpic({
          params: { id: target.id },
          body: {
            title: flags.title,
            description: flags.description,
            dependsOn: await this.dependsOn(projectId, flags["depends-on"]),
          },
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `Updated E${number}: ${changed.join(", ")}`,
        );
      });
    },
  });

  public readonly status = $command({
    name: "status",
    description:
      "Set an epic to draft or ready. The other statuses follow from its quests",
    args: EpicCommand.REF_ARG,
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      status: z
        .enum(["draft", "ready"])
        .describe(
          "draft keeps its quests out of the backlog; ready lets them be accepted.",
        ),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const updated = await this.epicApi.setEpicStatus({
          params: { id: target.id },
          body: { status: flags.status },
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `E${number} is now ${updated.status}`,
        );
      });
    },
  });

  /**
   * `lore epic set status`, named by the rule the help teaches:
   * `epic_set_status` is `lore epic set status`. Declared after its child.
   */
  public readonly set = $command({
    name: "set",
    description: "An epic's manual state: set its status",
    children: [this.status],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly shelve = $command({
    name: "shelve",
    description: "Set an epic and its open quests aside, as not done",
    args: EpicCommand.REF_ARG,
    flags: z.object({ ...EpicCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const shelved = await this.epicApi.shelveEpic({
          params: { id: target.id },
        });

        this.render.written(
          print,
          flags.output,
          shelved,
          `Shelved E${number}, with ${shelved.movedQuests} open quests`,
        );
      });
    },
  });

  public readonly unshelve = $command({
    name: "unshelve",
    description: "Bring a shelved epic back, with the quests its shelve took",
    args: EpicCommand.REF_ARG,
    flags: z.object({ ...EpicCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const unshelved = await this.epicApi.unshelveEpic({
          params: { id: target.id },
        });

        this.render.written(
          print,
          flags.output,
          unshelved,
          `Unshelved E${number}, with ${unshelved.movedQuests} quests`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete a draft or ready epic AND every quest filed under it, for good",
    args: EpicCommand.REF_ARG,
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe(
          "Required: this deletes the epic's quests too, and cannot be undone.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: E${number} and every quest filed under it would go for good. Pass --yes to delete them.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const result = await this.epicApi.deleteEpic({
          params: { id: target.id },
        });

        this.render.written(
          print,
          flags.output,
          result,
          `Deleted E${number}, with ${result.count ?? 0} quests`,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `epic` would shadow this one
   * silently.
   */
  public readonly epic = $command({
    name: "epic",
    description:
      "A project's epics: list, read, create, update, set status, shelve and delete them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.set,
      this.shelve,
      this.unshelve,
      this.delete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `--depends-on` as `dependsOn` takes it: absent leaves it alone, `0` clears
   * it, and a number is read first, so a wrong one fails with nothing written.
   */
  protected async dependsOn(
    projectId: number,
    ref: string | undefined,
  ): Promise<number | null | undefined> {
    if (ref === undefined) return undefined;
    if (ref === "0") return null;
    const predecessor = await this.epicApi.getEpicByNumber({
      params: { projectId, number: this.refs.epic(ref) },
    });
    return predecessor.id;
  }
}

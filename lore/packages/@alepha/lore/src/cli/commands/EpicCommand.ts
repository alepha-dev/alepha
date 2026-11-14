import type { EpicController, EpicReviewController } from "@lore/plan/api";
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
 * `lore epic list | get | create | update | set status | shelve | unshelve | delete`,
 * and `lore epic review create | answer` (#E121).
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
  protected readonly reviewApi = $client<EpicReviewController>(
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
        // `reviews` is what `epic_get` turns into `review` (#E121): the open
        // questions and the decision log.
        const { reviews } = epic;

        if (flags.output === "json") {
          this.render.json(print, epic);
          return;
        }

        const items = reviews.reviews
          .flatMap((review) => review.items)
          .sort((a, b) => a.number - b.number);
        const open = items.filter((item) => item.state === "open");
        const log = items.filter((item) =>
          item.kind === "question"
            ? item.state === "answered"
            : item.kind === "decision" && item.replacedBy == null,
        );

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
          sections: [
            ...(epic.folios.length
              ? [
                  {
                    title: "Folios",
                    lines: epic.folios.map(
                      (folio) => `F${folio.shortId}  ${folio.title}`,
                    ),
                  },
                ]
              : []),
            ...(open.length
              ? [
                  {
                    title: "Open review questions",
                    lines: open.flatMap((item) => [
                      `${item.number}. ${item.title}`,
                      ...item.suggestions.map(
                        (suggestion, index) =>
                          `   ${index}${item.recommended === index ? "*" : " "} ${suggestion.label}${suggestion.cost ? ` (${suggestion.cost})` : ""}`,
                      ),
                    ]),
                  },
                ]
              : []),
            ...(log.length
              ? [
                  {
                    title: "Decision log",
                    lines: log.map((item) =>
                      item.kind === "question"
                        ? `${item.number}. ${item.title} Answer: ${item.answer ?? ""}`
                        : `${item.number}. decision: ${item.title}`,
                    ),
                  },
                ]
              : []),
          ],
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

        const open = updated.openQuestions ?? 0;
        this.render.written(
          print,
          flags.output,
          updated,
          open > 0
            ? `E${number} is now ${updated.status}, with ${open} review questions still open`
            : `E${number} is now ${updated.status}`,
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
   * `lore epic review create`, `epic_review_create` by the naming rule. The
   * items are JSON, from a file or stdin (`--items @review.json`,
   * `--items @-`), in the shape the tool takes them.
   */
  public readonly reviewCreate = $command({
    name: "create",
    description:
      "File a review of a draft or ready epic: its questions, decisions and changes, in one record",
    args: EpicCommand.REF_ARG,
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      summary: z
        .text({
          maxLength: 2000,
          description: "What the review concluded, in a line or two.",
        })
        .optional(),
      items: z.text({
        size: "rich",
        atFile: true,
        description:
          'The items, a JSON array: [{"kind":"question","title":"...","context":"...","suggestions":[{"label":"...","cost":"..."}],"recommended":0}]. kind is question, decision or change; [] files an empty review.',
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const items = this.parseItems(flags.items);
        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const review = await this.reviewApi.createEpicReview({
          params: { id: target.id },
          body: { summary: flags.summary, items },
        });

        if (flags.output === "json") {
          this.render.json(print, review);
          return;
        }
        if (review.items.length > 0) {
          print(`Filed a review of E${number}, ${review.items.length} items:`);
        }
        this.render.list(
          print,
          review.items.map((item) => ({
            handle: String(item.number),
            title: item.title,
            fields: [item.kind],
          })),
          undefined,
          `Filed an empty review of E${number}.`,
        );
      });
    },
  });

  /**
   * `lore epic review answer <epic> --item <n>`, `epic_review_answer`. The
   * item is a flag, not a second positional: help titles one positional only.
   */
  public readonly reviewAnswer = $command({
    name: "answer",
    description:
      "Record the owner's answer to a review item: text, a suggestion, or a waive",
    args: EpicCommand.REF_ARG,
    flags: z.object({
      ...EpicCommand.PROJECT_FLAG,
      item: z
        .integer()
        .min(1)
        .describe("The item's number, per epic, as the review shows it."),
      answer: z
        .text({
          size: "rich",
          atFile: true,
          description:
            "The answer in the owner's words. On a decision, the decision that replaces it.",
        })
        .optional(),
      suggestion: z
        .integer()
        .min(0)
        .describe("Pick one of the item's suggestions, by index from 0.")
        .optional(),
      waive: z
        .boolean()
        .describe("Set a question aside unanswered.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.epic(args);
        const item = flags.item;
        const { projectId } = await this.projects.named(flags.project, context);

        const target = await this.epicApi.getEpicByNumber({
          params: { projectId, number },
        });
        const result = await this.reviewApi.answerEpicReviewItem({
          params: { id: target.id, number: item },
          body: {
            answer: flags.answer,
            suggestion: flags.suggestion,
            waive: flags.waive,
          },
        });

        this.render.written(
          print,
          flags.output,
          result,
          result.replacement
            ? `Overturned item ${item} of E${number}: decision ${result.replacement.number} replaces it`
            : `Item ${item} of E${number} is ${result.outcome}`,
        );
      });
    },
  });

  /**
   * `lore epic review`, declared after its children.
   */
  public readonly review = $command({
    name: "review",
    description: "An epic's reviews: file one, answer an item",
    children: [this.reviewCreate, this.reviewAnswer],
    handler: async ({ help }) => {
      help();
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
      "A project's epics: list, read, create, update, set status, shelve, delete and review them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.set,
      this.shelve,
      this.unshelve,
      this.delete,
      this.review,
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

  /**
   * `--items` as JSON, refused with a usage line before anything is sent.
   * The server validates each item's shape; this only checks it is a list.
   */
  protected parseItems(raw: string): any[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new UsageError(
        `--items is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new UsageError(
        "--items must be a JSON array of items; [] files an empty review.",
      );
    }
    return parsed;
  }
}

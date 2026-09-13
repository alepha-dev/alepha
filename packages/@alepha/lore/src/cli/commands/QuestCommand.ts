import { $inject, z } from "alepha";
import { $command, CommandError, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";
import type { EpicController } from "lore/api/controllers/EpicController";
import type { QuestCommentController } from "lore/api/controllers/QuestCommentController";
import type { QuestController } from "lore/api/controllers/QuestController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore quest list | get | create | update | accept | objective set | complete`.
 *
 * ```bash
 * lore quest list -p alepha --status in_progress --tag bug
 * lore quest get Q12 -p alepha
 * lore quest create -p alepha --title "Fix it" --area alepha/orm --priority high --description @plan.md
 * lore quest accept Q12 -p alepha
 * lore quest objective set Q12 --objective 0 -p alepha
 * lore quest complete Q12 -p alepha --message @- --commit 1a2b3c4 --waive 1="manual step"
 * ```
 *
 * Every command is one to four EXISTING actions called over `$client`, and no
 * aggregate: a CLI invocation is a process, and a second HTTP call inside it
 * costs milliseconds and no tokens (#F1264). So these do not reproduce what
 * the MCP tools aggregate for a model's sake: no comment counts or epic refs
 * in the list, no `diagramWarnings`.
 *
 * ## ⚠️ The epic is read before anything is written
 *
 * `quest create --epic` looks the epic up first, so an unknown number fails
 * with nothing written, and refuses before writing when its status already
 * says the attach or the accept will be refused.
 *
 * ## ⚠️ A partial write
 *
 * If the attach or the accept is refused anyway, the quest exists. stdout
 * carries it, in the format asked for, so a script reads its shortId instead
 * of retrying into a duplicate; stderr names what was and was not done; the
 * exit code is 1, never 4, because something was written. Nothing is unwound:
 * deleting from outside over HTTP is worse than saying so.
 *
 * ## ⚠️ The controller types are TYPES, and must stay ones
 *
 * Never re-exported from `index.ts`, or the private `lore` workspace reaches
 * the published `.d.ts` and `scripts/check-dts.ts` fails the build.
 */
export class QuestCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly questApi = $client<QuestController>(this.client.scope());
  protected readonly commentApi = $client<QuestCommentController>(
    this.client.scope(),
  );
  protected readonly epicApi = $client<EpicController>(this.client.scope());

  /**
   * The statuses `getQuests` filters on. Validated here because the action
   * drops a value it does not know and treats an empty list as no filter:
   * `--status accepted`, the word before #Q2269, would list everything.
   */
  public static readonly STATUSES = [
    "todo",
    "in_progress",
    "on_hold",
    "completed",
    "shelved",
  ] as const;

  public static readonly SIZES = ["XS", "S", "M", "L", "XL"];

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
      "The quest: 12, Q12 or '#Q12'. Quote #Q12: unquoted, a shell reads # as a comment.",
  });

  public readonly list = $command({
    name: "list",
    description: "List a project's quests, newest-updated first",
    flags: z.object({
      ...QuestCommand.PROJECT_FLAG,
      status: z
        .array(z.enum(QuestCommand.STATUSES))
        .describe(
          "Only quests in this status: todo, in_progress, on_hold, completed or shelved. Without it, every status but shelved.",
        )
        .optional(),
      tag: z
        .array(z.text())
        .describe("Only quests carrying this tag; several match any of them.")
        .optional(),
      epic: z
        .text({ description: "Only the quests of this epic: 45 or E45." })
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many quests to print, at most 100. Defaults to 20.")
        .default(20),
      offset: z
        .integer()
        .min(0)
        .describe("How many quests to skip, for the next page.")
        .default(0),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        // `getQuests` filters on the epic's global id, so a number is always
        // a lookup first.
        const epic = flags.epic
          ? await this.epicApi.getEpicByNumber({
              params: { projectId, number: this.refs.epic(flags.epic) },
            })
          : undefined;

        const page = await this.questApi.getQuests({
          params: { projectId },
          query: {
            size: flags.limit,
            offset: flags.offset,
            ...(flags.status?.length ? { status: flags.status.join(",") } : {}),
            ...(flags.tag?.length ? { tag: flags.tag.join(",") } : {}),
            ...(epic ? { epic: epic.id } : {}),
          },
        });

        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }

        this.render.list(
          print,
          page.content.map((quest) => ({
            handle: `Q${quest.shortId}`,
            title: quest.title,
            fields: [quest.metadata.status, quest.area],
          })),
          {
            offset: flags.offset,
            limit: flags.limit,
            total: page.page.totalElements,
          },
          "No quests match.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one quest: its fields, description, objectives with their ids, and discussion",
    args: QuestCommand.REF_ARG,
    flags: z.object({ ...QuestCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.quest(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const quest = await this.questApi.getQuestByShortId({
          params: { projectId, shortId },
        });
        // The discussion is where a correction to a quest lives, which is why
        // the MCP tool loads it too.
        const comments = await this.commentApi.listQuestComments({
          params: { id: quest.id },
          query: {},
        });

        if (flags.output === "json") {
          this.render.json(print, { ...quest, comments });
          return;
        }

        const { objectivesProgress } = quest.metadata;
        this.render.entity(print, {
          fields: [
            ["Quest", `Q${quest.shortId}`],
            ["Title", quest.title],
            ["Status", quest.metadata.status],
            ["Priority", quest.priority],
            ["Size", QuestCommand.SIZES[quest.size - 1]],
            ["Area", quest.area],
            ["Tags", quest.tags.join(", ")],
            ["Accepted", quest.acceptedAt],
            ["Completed", quest.completedAt],
            [
              "Objectives",
              objectivesProgress.total
                ? `${objectivesProgress.completed} done, ${objectivesProgress.waived} waived, of ${objectivesProgress.total}`
                : undefined,
            ],
          ],
          body: quest.description,
          sections: [
            ...(quest.objectives.length
              ? [
                  {
                    title: "Objectives",
                    lines: quest.objectives.map((objective) =>
                      this.render.objective(objective),
                    ),
                  },
                ]
              : []),
            ...(quest.completionMessage
              ? [{ title: "Completed with", lines: [quest.completionMessage] }]
              : []),
            ...(quest.commits?.length
              ? [
                  {
                    title: "Commits",
                    lines: quest.commits.map(
                      (commit) =>
                        `${commit.sha.slice(0, 9)}  ${commit.message ?? ""}`,
                    ),
                  },
                ]
              : []),
            ...(comments.length
              ? [
                  {
                    title: "Discussion",
                    lines: comments.flatMap((comment, index) => [
                      ...(index > 0 ? [""] : []),
                      `${comment.createdAt}${comment.source ? `  (agent${comment.source.client ? `: ${comment.source.client}` : ""})` : ""}`,
                      comment.body,
                    ]),
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
      "Create a quest, optionally filed into an epic and accepted in the same run",
    flags: z.object({
      ...QuestCommand.PROJECT_FLAG,
      title: z.text({ description: "What changes, in one line." }),
      area: z.text({
        maxLength: 48,
        description:
          "The part of the system it touches. Reuse an existing area's exact name: lore project info lists them.",
      }),
      priority: z
        .enum(["optional", "low", "medium", "high"])
        .describe("How urgent: optional, low, medium or high."),
      description: z
        .text({
          size: "rich",
          atFile: true,
          description: "Why, in Markdown.",
        })
        .optional(),
      size: z
        .integer()
        .min(1)
        .max(5)
        .describe("How big: 1 XS, 2 S, 3 M, 4 L, 5 XL. Defaults to 3.")
        .optional(),
      tag: z
        .array(z.text())
        .describe("A tag for the nature of the work: bug, feat, chore.")
        .optional(),
      objective: z
        .array(z.text({ size: "long" }))
        .describe("An objective, by its title, created unticked.")
        .optional(),
      epic: z
        .text({
          description:
            "File it into this epic, 45 or E45. The epic must be draft or ready, and ready with --accept.",
        })
        .optional(),
      accept: z
        .boolean()
        .describe(
          "Accept it too. A refused accept leaves the quest created and exits 1.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        // Read first, so an unknown number fails with nothing written.
        const epic = flags.epic
          ? await this.epicApi.getEpicByNumber({
              params: { projectId, number: this.refs.epic(flags.epic) },
            })
          : undefined;
        if (epic) {
          this.assertEpicTakes(epic, !!flags.accept);
        }

        const created = await this.questApi.createQuest({
          body: {
            projectId,
            title: flags.title,
            area: flags.area,
            priority: flags.priority,
            description: flags.description,
            size: flags.size,
            tags: flags.tag,
            objectives: flags.objective?.map((title) => ({
              title,
              completed: false,
            })),
          },
        });
        const handle = `Q${created.shortId}`;

        const done: string[] = [];
        let subject: unknown = created;
        try {
          if (epic) {
            await this.epicApi.attachQuest({
              params: { id: epic.id },
              body: { questId: created.id },
            });
            done.push(`filed into E${epic.number}`);
          }
          if (flags.accept) {
            subject = await this.questApi.acceptQuest({
              params: { id: created.id },
            });
            done.push("accepted");
          }
        } catch (error) {
          this.printWrite(
            print,
            flags.output,
            subject,
            `Created ${handle} ${created.title}${done.length ? `, ${done.join(", ")}` : ""}`,
          );
          const missed = [
            ...(epic && !done.includes(`filed into E${epic.number}`)
              ? [`file it into E${epic.number}`]
              : []),
            ...(flags.accept ? ["accept it"] : []),
          ];
          throw new CommandError(
            `Created ${handle}, but did not ${missed.join(" or ")}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error, exitCode: 1 },
          );
        }

        this.printWrite(
          print,
          flags.output,
          subject,
          `Created ${handle} ${created.title}${done.length ? `, ${done.join(", ")}` : ""}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change a quest's title, description, area, priority, size or tags",
    args: QuestCommand.REF_ARG,
    flags: z.object({
      ...QuestCommand.PROJECT_FLAG,
      title: z.text({ description: "A new title." }).optional(),
      description: z
        .text({
          size: "rich",
          atFile: true,
          description: "A new description, in Markdown. Replaces the old one.",
        })
        .optional(),
      area: z.text({ maxLength: 48, description: "A new area." }).optional(),
      priority: z
        .enum(["optional", "low", "medium", "high"])
        .describe("A new priority: optional, low, medium or high.")
        .optional(),
      size: z
        .integer()
        .min(1)
        .max(5)
        .describe("A new size: 1 XS, 2 S, 3 M, 4 L, 5 XL.")
        .optional(),
      tag: z
        .array(z.text())
        .describe(
          "The quest's tags. REPLACES the whole set: pass every tag it should keep, or '[]' to clear them.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.quest(args);
        const body = {
          ...(flags.title !== undefined ? { title: flags.title } : {}),
          ...(flags.description !== undefined
            ? { description: flags.description }
            : {}),
          ...(flags.area !== undefined ? { area: flags.area } : {}),
          ...(flags.priority !== undefined ? { priority: flags.priority } : {}),
          ...(flags.size !== undefined ? { size: flags.size } : {}),
          ...(flags.tag !== undefined ? { tags: flags.tag } : {}),
        };
        const changed = Object.keys(body);
        if (changed.length === 0) {
          throw new UsageError(
            "Nothing to update: pass at least one of --title, --description, --area, --priority, --size or --tag.",
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const quest = await this.questApi.getQuestByShortId({
          params: { projectId, shortId },
        });
        const updated = await this.questApi.updateQuestById({
          params: { id: quest.id },
          body,
        });

        this.printWrite(
          print,
          flags.output,
          updated,
          `Updated Q${quest.shortId}: ${changed.join(", ")}`,
        );
      });
    },
  });

  public readonly complete = $command({
    name: "complete",
    description:
      "Complete a quest in progress whose objectives are all ticked or waived",
    args: QuestCommand.REF_ARG,
    flags: z.object({
      ...QuestCommand.PROJECT_FLAG,
      message: z
        .text({
          size: "rich",
          atFile: true,
          description:
            "What was done, in Markdown: kept on the quest for the next reader.",
        })
        .optional(),
      waive: z
        .array(z.text({ size: "long" }))
        .describe(
          "Close an objective that was NOT done, as <id>=<reason>. A waiver records work not done: an objective that was done is ticked with lore quest objective set, never waived.",
        )
        .optional(),
      commit: z
        .array(z.text())
        .describe(
          "A commit that shipped the quest, by its sha (7 to 40 hex characters).",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.quest(args);
        // Both read before any call, so a typo is a usage error rather than
        // a 400 after the quest was looked up.
        const waive = (flags.waive ?? []).map((value) => this.waiver(value));
        const commits = (flags.commit ?? []).map((sha) => this.commitSha(sha));
        const { projectId } = await this.projects.named(flags.project, context);

        const quest = await this.questApi.getQuestByShortId({
          params: { projectId, shortId },
        });
        const completed = await this.questApi.completeQuest({
          params: { id: quest.id },
          body: {
            message: flags.message,
            ...(waive.length ? { waive } : {}),
            ...(commits.length ? { commits } : {}),
          },
        });

        this.printWrite(
          print,
          flags.output,
          completed,
          `Completed Q${quest.shortId} ${quest.title}`,
        );
      });
    },
  });

  public readonly accept = $command({
    name: "accept",
    description:
      "Accept a quest, to start working on it: it is assigned to you",
    args: QuestCommand.REF_ARG,
    flags: z.object({ ...QuestCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.quest(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const quest = await this.questApi.getQuestByShortId({
          params: { projectId, shortId },
        });
        // No special case for a quest already in progress, or an epic that
        // is a draft: the server says why, in its own words, and the command
        // does not guess who accepted it.
        const accepted = await this.questApi.acceptQuest({
          params: { id: quest.id },
        });

        this.printWrite(
          print,
          flags.output,
          accepted,
          `Accepted Q${quest.shortId} ${quest.title}`,
        );
      });
    },
  });

  public readonly objectiveSet = $command({
    name: "set",
    description:
      "Tick an objective of a quest in progress, or untick it with --no-completed",
    args: QuestCommand.REF_ARG,
    flags: z.object({
      ...QuestCommand.PROJECT_FLAG,
      objective: z
        .integer()
        .min(0)
        .describe(
          "The objective's id, the number lore quest get prints beside it.",
        ),
      completed: z
        .boolean()
        .describe(
          "The state to leave it in: ticked by default, --no-completed to untick. A state it already has changes nothing and exits 0. The quest is read, then the objective flipped only if it differs; a write landing between the two is not detected.",
        )
        .default(true),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.quest(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const quest = await this.questApi.getQuestByShortId({
          params: { projectId, shortId },
        });
        const target = quest.objectives.find(
          (objective) => objective.id === flags.objective,
        );
        if (!target) {
          const ids = quest.objectives.map(
            (objective) => `${objective.id} (${objective.title})`,
          );
          throw new UsageError(
            `Q${quest.shortId} has no objective ${flags.objective}. ${ids.length ? `Its objectives: ${ids.join(", ")}.` : "It has no objectives."}`,
          );
        }

        const word = flags.completed ? "ticked" : "unticked";
        // ⚠️ `completeObjective` FLIPS; it does not set. Calling it on a state
        // that already matches would undo the very tick a retry is repeating.
        if (target.completed === flags.completed) {
          this.printWrite(
            print,
            flags.output,
            quest,
            `Objective ${target.id} of Q${quest.shortId} is already ${word}: ${target.title}`,
          );
          return;
        }

        const updated = await this.questApi.completeObjective({
          params: { id: quest.id },
          body: { objectiveId: target.id },
        });

        this.printWrite(
          print,
          flags.output,
          updated,
          `${flags.completed ? "Ticked" : "Unticked"} objective ${target.id} of Q${quest.shortId}: ${target.title}`,
        );
      });
    },
  });

  /**
   * `lore quest objective set`, named by the rule the help teaches:
   * `quest_objective_set` is `lore quest objective set`. Declared after its
   * child, like every parent here.
   */
  public readonly objective = $command({
    name: "objective",
    description: "A quest's objectives: tick or untick one",
    children: [this.objectiveSet],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `quest` would shadow this one
   * silently.
   */
  public readonly quest = $command({
    name: "quest",
    description:
      "A project's quests: list, read, create, update, accept, tick and complete them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.accept,
      this.objective,
      this.complete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `--waive <id>=<reason>`, as `completeQuest` takes it.
   */
  protected waiver(value: string): { objectiveId: number; reason: string } {
    const match = /^(\d+)=(.*)$/s.exec(value);
    const reason = match?.[2].trim() ?? "";
    if (!match || !reason) {
      throw new UsageError(
        `--waive takes <id>=<reason>, an objective id and why it was not done; got '${value}'.`,
      );
    }
    return { objectiveId: Number(match[1]), reason };
  }

  /**
   * `--commit <sha>`, validated by the action's own rule, so a typo is a
   * usage error rather than a 400.
   */
  protected commitSha(sha: string): { sha: string } {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new UsageError(
        `--commit takes a sha of 7 to 40 hex characters; got '${sha}'.`,
      );
    }
    return { sha };
  }

  /**
   * A write, in the format asked for: the subject's response as JSON, or one
   * line for a human.
   */
  protected printWrite(
    print: (message?: string) => void,
    output: string,
    subject: unknown,
    line: string,
  ): void {
    if (output === "json") {
      this.render.json(print, subject);
      return;
    }
    this.render.write(print, line);
  }

  /**
   * Refuse, before anything is written, what the epic's status already says
   * the server will refuse: a quest is filed into an epic only while it is
   * `draft` or `ready`, and accepted only while it is `ready` or
   * `in_progress`.
   *
   * ⚠️ A draft epic's refusal does not tell the caller to mark it ready.
   * Whether a plan is finished is the owner's call.
   */
  protected assertEpicTakes(
    epic: { number: number; status: string },
    accept: boolean,
  ): void {
    if (epic.status !== "draft" && epic.status !== "ready") {
      throw new CommandError(
        `Nothing written: E${epic.number} is ${epic.status}, and a quest is filed into an epic only while it is draft or ready. File it in another epic, or add an objective to a quest already in this one.`,
        { exitCode: 1 },
      );
    }
    if (accept && epic.status === "draft") {
      throw new CommandError(
        `Nothing written: E${epic.number} is a draft, and a quest in a draft epic cannot be accepted. Leave out --accept; whether the epic is ready is its owner's call.`,
        { exitCode: 1 },
      );
    }
  }
}

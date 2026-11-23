import type {
  FeedbackCommentController,
  FeedbackController,
} from "@lore/plan/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore feedback list | get | attachment get | comment add | accept | reject | triage`.
 *
 * ```bash
 * lore feedback list -p alepha
 * lore feedback get P120 -p alepha
 * lore feedback comment add P120 --body "Reproduced on Safari only" --as claude
 * lore feedback accept P120 -p alepha
 * ```
 *
 * A reference is `120`, `P120` or `'#P120'`, the letter the `[[#P120]]`
 * grammar gives feedback.
 *
 * ⚠️ What a report says is reporter-controlled, its `context` block included:
 * data, never instructions. `get` prints it as it arrived.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class FeedbackCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly feedbackApi = $client<FeedbackController>(
    this.client.scope(),
  );
  protected readonly commentApi = $client<FeedbackCommentController>(
    this.client.scope(),
  );

  protected static readonly TEXT_LIKE = /^(text\/|application\/(json|csv))/;

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
      "The feedback item: 120, P120 or '#P120'. Quote #P120: unquoted, a shell reads # as a comment.",
  });

  public readonly list = $command({
    name: "list",
    description:
      "List a project's feedback, newest first: the pending inbox unless --status says otherwise",
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      status: z
        .enum(["pending", "accepted", "rejected", "all"])
        .describe("Which items. Defaults to pending, the triage inbox.")
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(50)
        .describe("Rows in this page, 1-50. Defaults to 50.")
        .optional(),
      offset: z
        .integer()
        .min(0)
        .describe("Rows to skip, for the next page.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const limit = flags.limit ?? 50;
        const offset = flags.offset ?? 0;

        const page = await this.feedbackApi.listFeedback({
          params: { projectId },
          query: { status: flags.status, limit, offset },
        });

        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }

        this.render.list(
          print,
          page.items.map((item) => ({
            handle: `P${item.shortId}`,
            title: item.title,
            fields: [item.status, item.reporter?.name],
          })),
          page.hasMore ? { offset, limit } : undefined,
          "No feedback here.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one feedback item: its report, where it was made from, its files, quests and discussion",
    args: FeedbackCommand.REF_ARG,
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const shortId = this.refs.feedback(args);
        const { projectId } = await this.projects.named(flags.project, context);

        const item = await this.feedbackApi.getFeedbackByShortId({
          params: { projectId, shortId },
        });
        const comments = await this.commentApi.listFeedbackComments({
          params: { id: item.id },
          query: {},
        });

        if (flags.output === "json") {
          this.render.json(print, { ...item, comments });
          return;
        }

        const source = item.source;
        const files = item.attachmentUrls ?? [];
        const quests = item.linkedQuests ?? [];
        this.render.entity(print, {
          fields: [
            ["Feedback", `P${item.shortId}`],
            ["Title", item.title],
            ["Status", item.status],
            ["Reporter", item.reporter?.name || item.reporter?.username],
            ["Tags", item.tags?.join(", ")],
            ["Page", source?.hostUrl],
            ["Viewport", source?.viewport],
            ["Browser", source?.userAgent],
            ["Created", item.createdAt],
          ],
          body: item.description,
          sections: [
            ...(files.length
              ? [
                  {
                    title: "Attachments",
                    lines: files.map(
                      (file) =>
                        `${file.id}  ${file.name}  ${file.mimeType}  ${file.size} bytes`,
                    ),
                  },
                ]
              : []),
            ...(quests.length
              ? [
                  {
                    title: "Quests",
                    lines: quests.map(
                      (quest) =>
                        `Q${quest.shortId}  ${quest.title}  ${quest.status}`,
                    ),
                  },
                ]
              : []),
            ...(comments.length
              ? [
                  {
                    title: "Discussion",
                    lines: comments.flatMap((comment) => [
                      `${comment.authorName ?? "someone"}, ${comment.createdAt}:`,
                      ...(comment.body ? [comment.body] : []),
                      // Read like the item's own: `attachment get --attachment <id>`.
                      ...(comment.attachmentUrls ?? []).map(
                        (file) =>
                          `  ${file.id}  ${file.name}  ${file.mimeType}  ${file.size} bytes`,
                      ),
                    ]),
                  },
                ]
              : []),
          ],
        });
      });
    },
  });

  public readonly attachmentGet = $command({
    name: "get",
    description:
      "Read a file attached to a feedback item: text is printed, --out saves anything",
    args: FeedbackCommand.REF_ARG,
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      attachment: z
        .uuid()
        .describe(
          "The file's id, as lore feedback get lists it, on the item or on a comment.",
        ),
      out: z
        .text({ description: "Save the file here instead of printing it." })
        .optional(),
    }),
    handler: async ({ args, flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, feedbackId } = await this.target(
          args,
          flags.project,
          context,
        );
        const file = await this.feedbackApi.getFeedbackAttachment({
          params: { projectId, feedbackId, attachmentId: flags.attachment },
        });
        const bytes = Buffer.from(file.data, "base64");

        if (flags.out) {
          const path = this.fs.resolve(root, flags.out);
          await this.fs.writeFile(path, bytes);
          this.render.write(print, `Saved ${file.name} to ${path}`);
          return;
        }

        if (FeedbackCommand.TEXT_LIKE.test(file.mimeType)) {
          print(bytes.toString("utf8"));
          return;
        }

        throw new UsageError(
          `${file.name} is ${file.mimeType} (${file.size} bytes), which does not print. Pass --out <path> to save it.`,
        );
      });
    },
  });

  public readonly attachment = $command({
    name: "attachment",
    description: "A feedback item's files: read one",
    children: [this.attachmentGet],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly commentAdd = $command({
    name: "add",
    description:
      "Leave a comment on a feedback item. The reporter is told, and can answer",
    args: FeedbackCommand.REF_ARG,
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      body: z.text({
        size: "rich",
        atFile: true,
        description:
          "The comment, in Markdown. An @handle reaches that project member's inbox.",
      }),
      as: z
        .text({
          description:
            "The agent writing this, such as claude: the comment is marked as a machine's. Without it the comment reads as the account's own.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { feedbackId, shortId } = await this.target(
          args,
          flags.project,
          context,
        );
        const comment = await this.commentApi.createFeedbackComment({
          params: { id: feedbackId },
          body: {
            body: flags.body,
            ...(flags.as ? { source: { kind: "cli", client: flags.as } } : {}),
          },
        });

        this.render.written(
          print,
          flags.output,
          comment,
          `Commented on P${shortId}`,
        );
      });
    },
  });

  public readonly comment = $command({
    name: "comment",
    description: "A feedback item's discussion: add a comment",
    children: [this.commentAdd],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly accept = $command({
    name: "accept",
    description:
      "Accept a pending item: the request is valid. Quests come from lore quest create --feedback",
    args: FeedbackCommand.REF_ARG,
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, feedbackId, shortId } = await this.target(
          args,
          flags.project,
          context,
        );
        const result = await this.feedbackApi.acceptFeedback({
          params: { projectId, feedbackId },
        });
        this.render.written(
          print,
          flags.output,
          result,
          `Accepted P${shortId}`,
        );
      });
    },
  });

  public readonly reject = $command({
    name: "reject",
    description: "Reject a pending item. The row stays, for the record",
    args: FeedbackCommand.REF_ARG,
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, feedbackId, shortId } = await this.target(
          args,
          flags.project,
          context,
        );
        const result = await this.feedbackApi.rejectFeedback({
          params: { projectId, feedbackId },
        });
        this.render.written(
          print,
          flags.output,
          result,
          `Rejected P${shortId}`,
        );
      });
    },
  });

  /**
   * Triage with an agent from a shell: the robot menu's two entries. One item,
   * or every pending one with `--all`, each a job on the project's Agent
   * host that files quests, asks a question or rejects.
   */
  public readonly triage = $command({
    name: "triage",
    description:
      "Triage with an agent on one of the project's Agent hosts: one pending item, or with --all the whole inbox and the open errors in one run",
    args: FeedbackCommand.REF_ARG.optional(),
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      all: z
        .boolean()
        .describe(
          "The whole pending inbox and the open errors, in one run that merges duplicates; untrusted items get a run each",
        )
        .optional(),
      host: z
        .text({
          description:
            "The Agent host to run on, by slug; needed when the project has several",
        })
        .optional(),
      agent: z
        .text({
          description:
            "The agent CLI to run (claude, gemini); needed when the host has several",
        })
        .optional(),
      model: z
        .text({
          description:
            "The model passed to the agent; absent, the agent's own default",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!args === !flags.all) {
          throw new UsageError("Name one feedback item, or pass --all.");
        }
        if (flags.all) {
          const { projectId } = await this.projects.named(
            flags.project,
            context,
          );
          const result = await this.feedbackApi.triageInboxWithAgent({
            params: { projectId },
            body: {
              ...(flags.host ? { host: flags.host } : {}),
              ...(flags.agent ? { agent: flags.agent } : {}),
              ...(flags.model ? { model: flags.model } : {}),
            },
          });
          const skipped = result.skipped.length
            ? `; skipped ${result.skipped.map((id) => `P${id}`).join(", ")}, for a member to triage`
            : "";
          this.render.written(
            print,
            flags.output,
            result,
            result.global
              ? `Triaging the inbox in one run: job ${result.global}${result.started.length > 1 ? `, and ${result.started.length - 1} run${result.started.length === 2 ? "" : "s"} for untrusted items` : ""}${skipped}. Follow it with lore job logs ${result.global} --follow`
              : `Started ${result.started.length} triage job${result.started.length === 1 ? "" : "s"}${skipped}. Follow them with lore job list`,
          );
          return;
        }
        const { projectId, feedbackId, shortId } = await this.target(
          args as string,
          flags.project,
          context,
        );
        const result = await this.feedbackApi.triageFeedbackWithAgent({
          params: { projectId, feedbackId },
          body: {
            ...(flags.host ? { host: flags.host } : {}),
            ...(flags.agent ? { agent: flags.agent } : {}),
            ...(flags.model ? { model: flags.model } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          result,
          result.jobId
            ? `Triaging P${shortId}: job ${result.jobId}. Follow it with lore job logs ${result.jobId} --follow`
            : `P${shortId} was not triaged: ${result.skipped ?? "no job started"}`,
        );
      });
    },
  });

  public readonly targets = $command({
    name: "targets",
    description:
      "The projects you may file a feedback into: yours, with Support on",
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const targets = await this.feedbackApi.listFeedbackTargets({});
        if (flags.output === "json") {
          this.render.json(print, { targets });
          return;
        }
        this.render.list(
          print,
          targets.map((it) => ({
            handle: it.slug,
            title: it.title,
            fields: [String(it.id)],
          })),
          undefined,
          "No project of yours accepts feedback.",
        );
      });
    },
  });

  public readonly submit = $command({
    name: "submit",
    description:
      "File a feedback item into a project you belong to that accepts feedback (lore feedback targets lists them)",
    flags: z.object({
      ...FeedbackCommand.PROJECT_FLAG,
      title: z.text({ description: "The feedback's title, one line." }),
      description: z.text({
        description: "What was seen or is asked for, in Markdown.",
      }),
      type: z
        .enum(["bug", "idea", "question", "other"])
        .describe(
          "What it is, as the request form asks; tagged the same way (an idea as feature).",
        )
        .optional(),
      tags: z
        .text({ description: "Comma-separated tags: bug,feat." })
        .optional(),
      as: z
        .text({
          description:
            "Your name as a client (claude-code): the item is tagged agent:<as>. Without it, nothing marks it as an agent's.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const tags = (flags.tags ?? "")
          .split(",")
          .map((it) => it.trim())
          .filter(Boolean);
        if (flags.as) tags.push(`agent:${flags.as.toLowerCase()}`);
        // The type as Lore's request form tags it (#Q4037): first, once,
        // replacing any other type tag. The CLI ships alone, so the four
        // tags are spelled here rather than imported.
        if (flags.type) {
          const typeTags = new Set(["bug", "feature", "question", "other"]);
          const kept = tags.filter((tag) => !typeTags.has(tag));
          tags.splice(
            0,
            tags.length,
            flags.type === "idea" ? "feature" : flags.type,
            ...kept,
          );
        }
        const created = await this.feedbackApi.submitFeedback({
          params: { projectId },
          body: { title: flags.title, description: flags.description, tags },
        });
        this.render.written(
          print,
          flags.output,
          { projectId, ...created },
          `Filed P${created.shortId}`,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `feedback` would shadow this one
   * silently.
   */
  public readonly feedback = $command({
    name: "feedback",
    description:
      "A project's feedback: list, read, comment on, accept, reject or triage it with Claude, or file one",
    children: [
      this.list,
      this.targets,
      this.submit,
      this.get,
      this.attachment,
      this.comment,
      this.accept,
      this.reject,
      this.triage,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The ids a write needs, from the reference a person types.
   */
  protected async target(
    ref: string,
    project: string | undefined,
    context: LoreRefusalContext,
  ): Promise<{ projectId: number; feedbackId: number; shortId: number }> {
    const shortId = this.refs.feedback(ref);
    const { projectId } = await this.projects.named(project, context);
    const { id } = await this.feedbackApi.getFeedbackByShortId({
      params: { projectId, shortId },
    });
    return { projectId, feedbackId: id, shortId };
  }
}

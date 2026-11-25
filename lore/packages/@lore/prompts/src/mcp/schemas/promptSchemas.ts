import {
  PROMPT_CHECKS,
  PROMPT_SOURCES,
  projectParamsSchema,
  promptResourceSchema,
} from "@lore/core/schemas";
import { z } from "alepha";

/*
 * The `prompt_*` tools' params and results (#Q4282), one family: each param
 * is named as its `lore prompt` flag, which `mcp-cli-parity.spec.ts` checks.
 */

const name = z
  .text({ maxLength: 64 })
  .describe("The prompt's name: a built-in's (work-quest) or a custom one's.");

const args = z
  .array(z.text({ maxLength: 200 }))
  .max(4)
  .describe(
    "The prompt's args, each `name:type` or `name:type:status|status` (the statuses it accepts). Types: epic, quest, feedback, pullRequest, member, useCase, persona, requirement, folio. Custom prompts only.",
  );

const set = z
  .array(z.text({ maxLength: 160 }))
  .max(8)
  .describe(
    "A value per arg, each `arg=reference`: `quest=#Q12`, `epic=E3`, `feedback=P40`, a pull request's number, a member's id. A member arg left out is the caller.",
  );

export const promptNameParamsSchema = projectParamsSchema.extend({ name });

export const promptCreateParamsSchema = projectParamsSchema.extend({
  name,
  text: z
    .string()
    .min(1)
    .max(131_072)
    .describe(
      "The words, with `{{arg.field}}`, `{{project}}`, `{{slug}}` and `{{projectUrl}}` placeholders.",
    ),
  title: z.text({ maxLength: 120 }).optional(),
  description: z.string().max(2000).optional(),
  args: args.optional(),
  source: z
    .enum(PROMPT_SOURCES)
    .describe(
      "The code its runs find: none, read (the repository, read-only) or write (a worktree on a branch). Set on the prompt, never at a run.",
    )
    .optional(),
  ref: z
    .text({ maxLength: 200 })
    .describe("The branch, tag or commit its code is at.")
    .optional(),
});

export const promptUpdateParamsSchema = promptCreateParamsSchema
  .partial()
  .extend({
    name,
    project: projectParamsSchema.shape.project,
    project_name: projectParamsSchema.shape.project_name,
    host: z
      .text({ maxLength: 64 })
      .describe("The Agent host its runs use, by slug.")
      .optional(),
    agent: z
      .text({ maxLength: 32 })
      .describe("The agent CLI its runs use.")
      .optional(),
    model: z.text({ maxLength: 96 }).optional(),
    enabled: z
      .boolean()
      .describe("Off, its trigger stops; a run by hand still works.")
      .optional(),
    on: z
      .text({ maxLength: 1024 })
      .describe(
        "Its trigger in one word: manual, event:<key>[,<key>] (event_catalog lists them), hourly, 6h, daily@<h>, weekly@<day>@<h>, or an event part and a schedule part joined by a comma. Hours are UTC.",
      )
      .optional(),
    check: z
      .array(z.enum(PROMPT_CHECKS))
      .max(4)
      .describe(
        "Run a triggered run only when one of these has something to do.",
      )
      .optional(),
    set: set.optional(),
    max_per_hour: z.integer().min(1).max(60).optional(),
    max_per_day: z.integer().min(1).max(1000).optional(),
    pins: z
      .array(z.text({ maxLength: 32 }))
      .max(16)
      .describe(
        "The pages it is pinned to, replacing the list: quests, quest, epics, epic, feedback, feedback-item, errors.",
      )
      .optional(),
  });

export const promptDuplicateParamsSchema = projectParamsSchema.extend({
  name,
  new_name: z.text({ maxLength: 64 }).describe("The copy's name."),
  title: z.text({ maxLength: 120 }).optional(),
});

export const promptRenderParamsSchema = projectParamsSchema.extend({
  name,
  set: set.optional(),
});

export const promptRunParamsSchema = projectParamsSchema.extend({
  name,
  set: set.optional(),
  host: z
    .text({ maxLength: 64 })
    .describe("The Agent host, by slug; agent_hosts lists them.")
    .optional(),
  agent: z
    .text({ maxLength: 32 })
    .describe("The agent CLI; absent, the first the host reports.")
    .optional(),
  model: z
    .text({ maxLength: 96 })
    .describe("The model; absent, the CLI's default.")
    .optional(),
  fix: z
    .boolean()
    .describe("review-pr: push fixes to the pull request's branch.")
    .optional(),
  trust: z
    .boolean()
    .describe("review-pr: you trust the pull request's author.")
    .optional(),
  continue: z
    .uuid()
    .describe(
      "A run of this prompt that failed, timed out or was cancelled: the new run continues it on its host, in its workspace and on its branch, with the work it left, and resumes its agent session. Its args stand when set is absent.",
    )
    .optional(),
});

export const promptListResultSchema = z.object({
  items: z.array(promptResourceSchema),
  pausedAt: z.string().optional(),
});

export const promptRenderResultSchema = z.object({ text: z.string() });

export const promptRunResultSchema = z.object({
  jobId: z.uuid(),
  skipped: z.array(z.integer()),
});

export const promptPausedResultSchema = z.object({
  pausedAt: z.string().optional(),
});

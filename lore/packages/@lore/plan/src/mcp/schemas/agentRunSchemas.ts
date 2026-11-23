import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

/**
 * `agent_run`'s params (#Q4225), the same as `lore agent run`'s argument and
 * flags.
 */
export const agentRunParamsSchema = projectParamsSchema.extend({
  prompt: z
    .enum(["triage", "build", "text"])
    .describe(
      "What to run: `triage` (the project's Triage prompt over the feedback inbox and the open errors), `build` (the Build prompt on one accepted quest, with `quest`), or `text` (your own words, in `text`).",
    ),
  quest: z
    .integer()
    .optional()
    .describe("The quest a `build` works, by its number."),
  text: z.string().max(131_072).optional().describe("A `text` prompt's words."),
  host: z
    .string()
    .max(64)
    .optional()
    .describe(
      "The Agent host, by slug; needed when the project has several (agent_hosts lists them).",
    ),
  agent: z
    .string()
    .max(32)
    .optional()
    .describe(
      "The agent CLI (claude, gemini); needed when the host reports several.",
    ),
  model: z
    .string()
    .max(80)
    .optional()
    .describe("The model passed to the agent; absent, its own default."),
  workspace: z
    .string()
    .max(63)
    .optional()
    .describe(
      "The workspace a `text` prompt runs in, a directory kept on the host between runs; `triage` by default.",
    ),
  timeout: z
    .integer()
    .min(60)
    .max(7200)
    .optional()
    .describe("A `text` prompt's time, in seconds."),
});

export const agentRunResultSchema = z.object({
  jobId: z.uuid().optional(),
  skipped: z.array(z.integer()),
});

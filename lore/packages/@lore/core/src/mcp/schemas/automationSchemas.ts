import { z } from "alepha";

import { agentAutomationResourceSchema } from "../../api/schemas/agentAutomationResourceSchema.ts";
import { agentAutomationRunResultSchema } from "../../api/schemas/agentAutomationRunResultSchema.ts";
import { agentAutomationSettingsSchema } from "../../api/schemas/agentAutomationSettingsSchema.ts";
import { AUTOMATION_PROMPT_KINDS } from "../../api/schemas/agentAutomationValues.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * The agent automation tools (#Q4231), twins of `lore automation`.
 */
const NAME = z
  .string()
  .describe(
    "The automation's name, unique in the project: lowercase letters, digits, dashes and underscores, up to 48.",
  );

const ON_DESCRIPTION =
  "When it runs: `manual` (only by hand), `event:<key>[,<key>]` (on project events, keys from event_catalog, e.g. `event:feedback.created`), `hourly`, `6h` (00, 06, 12, 18 UTC) or `daily@<utc-hour>` (e.g. `daily@7`).";

/**
 * What create and update share: every field optional on update.
 */
const writeFields = {
  text: z
    .string()
    .describe(
      "A `text` automation's words, run under Lore's preamble; a `chat` automation's request to its agent.",
    )
    .optional(),
  host: z
    .string()
    .describe(
      "The Agent host, by slug; needed when the project has several (agent_hosts).",
    )
    .optional(),
  agent: z
    .string()
    .describe(
      "The agent CLI (claude, gemini); needed when the host has several. For a `chat` automation, the handle of the project chat agent it runs.",
    )
    .optional(),
  room: z
    .string()
    .describe(
      "A `chat` automation's room, by name: its agent answers there. Chat only.",
    )
    .optional(),
  model: z
    .string()
    .describe("The model passed to the agent; absent, its own default.")
    .optional(),
  source: z
    .enum(["none", "read", "write", ""])
    .describe(
      "The code its jobs find: `none`, `read` (the repository at `ref`, read-only) or `write` (a worktree on a branch Lore names). Absent, a build writes and the others read; an empty string clears it.",
    )
    .optional(),
  ref: z
    .string()
    .max(200)
    .describe(
      "The branch, tag, commit or pull/<n>/head its jobs' code is at; the default branch when absent. An empty string clears it.",
    )
    .optional(),
  on: z.string().describe(ON_DESCRIPTION).optional(),
  only_if_work: z
    .boolean()
    .describe(
      "Run only when Lore finds something to do first (a pending item for a triage, a quest to build), so an idle project spends no tokens. Not for a text prompt.",
    )
    .optional(),
  auto_merge: z
    .boolean()
    .describe(
      "A build's pull requests ask for auto-merge (`gh pr merge --auto`). Build only.",
    )
    .optional(),
  concurrency: z
    .integer()
    .min(1)
    .max(16)
    .describe(
      "How many build jobs run at once, one quest each (default 1). Build only; above the host's own limit the extra jobs wait in its queue.",
    )
    .optional(),
  settle_seconds: z
    .integer()
    .min(0)
    .max(3600)
    .describe(
      "How long an event run waits after the first event of a burst, so the burst lands in one prompt (default 60).",
    )
    .optional(),
  max_runs_per_hour: z
    .integer()
    .min(1)
    .max(60)
    .describe("The most runs its trigger starts in an hour (default 6).")
    .optional(),
  max_runs_per_day: z
    .integer()
    .min(1)
    .max(1000)
    .describe("The most runs its trigger starts in a day (default 48).")
    .optional(),
};

export const automationListParamsSchema = projectParamsSchema;

export const automationListResultSchema = z.object({
  automations: z.array(
    agentAutomationResourceSchema.extend({
      on: z.string().describe("Its trigger, in `on`'s form."),
    }),
  ),
});

export const automationCreateParamsSchema = projectParamsSchema.extend({
  name: NAME,
  prompt: z
    .enum(AUTOMATION_PROMPT_KINDS)
    .describe(
      "`triage` (the project's Triage prompt over the inbox and the open errors), `build` (every quest not tagged needs-human into a pull request), `text` (your own words) or `chat` (a project chat agent's rounds in a room, run in Lore: `agent`, `room` and `text`).",
    ),
  ...writeFields,
  enabled: z
    .boolean()
    .describe("Whether its trigger runs it (default true).")
    .optional(),
});

export const automationUpdateParamsSchema = projectParamsSchema.extend({
  name: NAME,
  new_name: z.string().describe("A new name.").optional(),
  prompt: z.enum(AUTOMATION_PROMPT_KINDS).optional(),
  ...writeFields,
  enabled: z.boolean().describe("Turn its trigger on or off.").optional(),
});

export const automationNameParamsSchema = projectParamsSchema.extend({
  name: NAME,
});

export const automationResultSchema = agentAutomationResourceSchema;

export const automationDeleteResultSchema = z.object({
  ok: z.boolean(),
});

export const automationRunResultSchema = agentAutomationRunResultSchema;

export const automationSettingsParamsSchema = projectParamsSchema.extend({
  builds_per_day: z
    .integer()
    .min(0)
    .max(1000)
    .describe(
      "Set the project's daily ceiling on builds its automations start (default 20).",
    )
    .optional(),
});

export const automationSettingsResultSchema = agentAutomationSettingsSchema;

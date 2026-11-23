import {
  attachmentPushResultSchema,
  projectParamsSchema,
} from "@lore/core/schemas";
import { type Infer, z } from "alepha";

import { actorRoleSchema } from "../../api/schemas/actorRoleSchema.ts";
import { criterionMethodSchema } from "../../api/schemas/criterionMethodSchema.ts";
import { useCasePrioritySchema } from "../../api/schemas/useCasePrioritySchema.ts";
import { useCaseResourceSchema } from "../../api/schemas/useCaseResourceSchema.ts";
import { useCaseStatusSchema } from "../../api/schemas/useCaseStatusSchema.ts";

const numberSchema = z
  .integer()
  .describe("The use case's per-project number: 7 for #U7.");

/**
 * The scenario an agent writes, in persona NUMBERS (#A2 is 2): each list
 * REPLACES the use case's own when it is sent.
 */
const scenarioFieldsSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe("The scenario, in one line.")
    .optional(),
  status: useCaseStatusSchema
    .exclude(["validated"])
    .describe("draft, ready or deprecated. Validation is usecase_validate's.")
    .optional(),
  priority: useCasePrioritySchema.optional(),
  preconditions: z
    .string()
    .describe("What holds before the scenario, in Markdown.")
    .optional(),
  startingData: z
    .string()
    .max(300)
    .describe("The seed path run first.")
    .optional(),
  automatedTestPath: z
    .string()
    .max(300)
    .describe("The e2e spec playing it.")
    .optional(),
  automatedTestTag: z.string().max(60).describe("Its tag, `@U7`.").optional(),
  actors: z
    .array(
      z.object({
        persona: z.integer().describe("The persona's number: 2 for #A2."),
        role: actorRoleSchema
          .optional()
          .describe("primary (default), beneficiary or system."),
      }),
    )
    .describe("Who plays it. Replaces the list.")
    .optional(),
  steps: z
    .array(
      z.object({
        actor: z
          .integer()
          .optional()
          .describe(
            "The persona number acting this step; omit for the system.",
          ),
        text: z.string().min(1),
      }),
    )
    .describe("The main flow, in order. Replaces the list.")
    .optional(),
  alternatives: z
    .array(
      z.object({
        key: z.string().min(1).max(10).describe("`4a`."),
        text: z.string().min(1),
      }),
    )
    .describe("Alternative paths, kept inside the use case. Replaces the list.")
    .optional(),
  criteria: z
    .array(
      z.object({
        key: z
          .string()
          .optional()
          .describe(
            "An existing key (`C2`) to keep it. Omit for a new criterion: keys are assigned and never reused.",
          ),
        givenText: z.string().optional(),
        whenText: z.string().optional(),
        thenText: z.string().optional(),
        text: z
          .string()
          .optional()
          .describe(
            "A criterion in one sentence, instead of Given / When / Then.",
          ),
        method: criterionMethodSchema
          .optional()
          .describe("e2e, agent or manual (default)."),
        alternativeKey: z
          .string()
          .optional()
          .describe("The alternative it belongs to (`4a`)."),
      }),
    )
    .describe("Acceptance criteria, in order. Replaces the list.")
    .optional(),
});

export const useCaseListParamsSchema = projectParamsSchema.extend({
  status: useCaseStatusSchema
    .optional()
    .describe("Only use cases in this status."),
});

export const useCaseListResultSchema = z.object({
  useCases: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      title: z.string(),
      status: useCaseStatusSchema,
      priority: useCasePrioritySchema,
      actors: z.array(z.string()).describe("#A references of who plays it."),
      coveredBy: z
        .array(z.integer())
        .describe("Numbers of the epics covering it."),
      criteria: z.integer(),
      scenarioVersion: z.integer(),
    }),
  ),
});

export const useCaseGetParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});

export const useCaseGetResultSchema = useCaseResourceSchema.extend({
  comments: z.array(
    z.object({ id: z.integer(), body: z.string(), createdAt: z.datetime() }),
  ),
});

export const useCaseCreateParamsSchema = projectParamsSchema.extend(
  scenarioFieldsSchema.required({ title: true }).shape,
);

export const useCaseWriteResultSchema = useCaseResourceSchema;

export const useCaseUpdateParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  ...scenarioFieldsSchema.shape,
});

export const useCaseDeleteParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});

export const useCaseDeleteResultSchema = z.object({
  ok: z.boolean(),
  number: z.integer(),
});

export const useCaseCommentAddParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  body: z
    .string()
    .min(1)
    .describe("The comment, in Markdown. `@name` reaches a member's inbox."),
  as: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe("Your own name as a client, e.g. `claude-code`."),
});

export const useCaseCommentAddResultSchema = z.object({
  id: z.integer(),
  createdAt: z.datetime(),
});

export const useCaseLinkEpicParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  epic_number: z.integer().describe("The epic's number: 12 for #E12."),
  linked: z
    .boolean()
    .optional()
    .describe(
      "true (default) makes the epic cover the use case; false removes it.",
    ),
});

export const useCaseValidateParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  decision: z
    .enum(["validated", "changes_requested"])
    .describe(
      "validated sets the use case to validated; changes_requested sends it back to draft.",
    ),
  note: z
    .string()
    .max(2000)
    .optional()
    .describe("Why, kept on the use case and in its Activity."),
});

export const useCaseRunRecordParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  by: z
    .enum(["agent", "ci", "person"])
    .describe("Who played it: agent (you), ci or person."),
  client: z
    .string()
    .max(60)
    .optional()
    .describe("Your name as a client, e.g. `claude-code`."),
  app: z
    .string()
    .max(120)
    .optional()
    .describe("The app copy played on: its app name. Omit for local."),
  env: z
    .string()
    .max(120)
    .optional()
    .describe("The copy's environment (`staging`), or `local`."),
  note: z
    .string()
    .max(4000)
    .optional()
    .describe("What the run saw, in Markdown."),
  results: z
    .array(
      z.object({
        key: z.string().describe("The criterion's key: C2."),
        result: z.enum(["passed", "failed", "not_run"]),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Why, for a failure, read by a person first, one line per label: `Expected: ...`, `Seen: ...`, `Also: ...` (optional), then `Details: ...` (page, state, repro steps, ids) for the developer. Lore shows the labels as rows and folds the details.",
          ),
      }),
    )
    .describe(
      "One result per criterion played. A criterion left out is recorded as not run.",
    ),
});

export const useCaseRunRecordResultSchema = z.object({
  runId: z
    .integer()
    .describe("Attach evidence to it with `lore attachments push --run <id>`."),
  errorsOpened: z.integer(),
  errorRule: z
    .enum(["opened", "in_development", "no_inbox", "none"])
    .describe(
      "What a failure did: opened errors (one per failed criterion), stayed in_development (a covering quest is open), or no_inbox (Ship's track is off: the use case shows Failing).",
    ),
});

/**
 * `usecase_run_attachment_add` (#Q3977): like `quest_attachment_add`, it moves
 * no bytes and hands back the `lore attachments push --run` line to run.
 */
export const useCaseRunAttachmentAddParamsSchema = z.object({
  run: z
    .integer()
    .describe("The run's id, as `usecase_run_record` answered it (runId)."),
  file: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "Path to the file on the machine you will run the command on, e.g. `./c2-receipt.png`. Used to fill in the returned command line; nothing is read here.",
    ),
  criterion: z
    .string()
    .max(10)
    .optional()
    .describe(
      "The criterion the file shows, C2: the Runs tab lists it under that criterion. Must be one the run recorded.",
    ),
  step: z.integer().optional().describe("The scenario step the file shows."),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Name to store it under, if it should differ from the file's own.",
    ),
});

export const useCaseRunAttachmentAddResultSchema =
  attachmentPushResultSchema.extend({
    shortId: z
      .integer()
      .describe(
        "The run's id, as the command addresses it. Confirmed to exist before this was returned.",
      ),
  });

export const useCasePromptParamsSchema = projectParamsSchema.extend({
  number: z
    .integer()
    .optional()
    .describe("The use case (7 for #U7), for the test, spec and demo modes."),
  mode: z
    .enum(["test", "spec", "demo", "explore", "import", "draft"])
    .describe(
      "test: play the criteria and record a run; spec: write the tagged e2e spec; demo: a demo script; explore: exploratory testing as a persona (needs persona); import: split a specification folio into requirements (needs folio_shortId); draft: draft the use cases of a requirement or an epic (needs requirement_number or epic_number).",
    ),
  persona: z
    .integer()
    .optional()
    .describe(
      "A persona's number (2 for #A2): the subject of explore, or of test over its use cases.",
    ),
  folio_shortId: z
    .integer()
    .optional()
    .describe("The specification folio, for import."),
  requirement_number: z
    .integer()
    .optional()
    .describe("The requirement (15 for #S15), for draft."),
  epic_number: z
    .integer()
    .optional()
    .describe("The epic (5 for #E5), for draft."),
  stale: z
    .boolean()
    .optional()
    .describe("With persona and test: only its stale use cases."),
  app: z.string().optional().describe("The app copy to play on: its app name."),
  env: z.string().optional().describe("Its environment (staging), or local."),
  as: z
    .integer()
    .optional()
    .describe("The persona to play, by number (2 for #A2)."),
});

export const useCasePromptResultSchema = z.object({
  kind: z.string(),
  prompt: z
    .string()
    .describe("The prompt to follow: it is what the Verify dialog copies."),
  command: z.string().describe("The lore command that prints the same prompt."),
});

export type ScenarioFields = Infer<typeof scenarioFieldsSchema>;

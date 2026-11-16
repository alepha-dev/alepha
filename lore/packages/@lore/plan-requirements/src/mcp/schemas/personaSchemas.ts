import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

import { personaInputSchema } from "../../api/schemas/personaInputSchema.ts";
import { personaKindSchema } from "../../api/schemas/personaKindSchema.ts";
import { personaResourceSchema } from "../../api/schemas/personaResourceSchema.ts";

/**
 * The persona's fields an agent writes, each described once: the tool
 * descriptions are what every agent reads on connect.
 */
const personaFieldsSchema = personaInputSchema.extend({
  kind: personaKindSchema
    .describe(
      "human (a person), system (another system) or agent (an AI agent).",
    )
    .optional(),
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("The persona's name: 'Léa'.")
    .optional(),
  role: z.string().max(120).describe("One line: 'Shop manager'.").optional(),
  who: z.string().describe("Who they are, in Markdown.").optional(),
  goals: z
    .string()
    .describe("What they want to achieve, in Markdown.")
    .optional(),
  frustrations: z
    .string()
    .describe("What gets in their way, in Markdown.")
    .optional(),
  alephaRole: z
    .string()
    .max(120)
    .describe(
      "The `$role` or service account this persona plays in the app. Free text.",
    )
    .optional(),
  demoAccount: z
    .string()
    .max(200)
    .describe(
      "The demo login (an e-mail or a username). NEVER a password: Lore stores no credential.",
    )
    .optional(),
  demoSeed: z
    .string()
    .max(300)
    .describe(
      "Path, in the app's repository, of the seed that creates the demo account.",
    )
    .optional(),
  environmentApp: z
    .string()
    .max(120)
    .describe(
      "The app copy the persona lives on: its app name, with `environmentEnv`.",
    )
    .optional(),
  environmentEnv: z
    .string()
    .max(120)
    .describe("The app copy's environment name (`staging`, `production`).")
    .optional(),
  areas: z
    .array(z.string())
    .describe("Areas of the project the persona belongs to.")
    .optional(),
});

const numberSchema = z
  .integer()
  .describe("The persona's per-project number: 2 for #A2.");

export const personaListParamsSchema = projectParamsSchema.extend({
  kind: personaKindSchema.optional().describe("Only personas of this kind."),
});

export const personaListResultSchema = z.object({
  personas: z.array(
    personaResourceSchema.pick({
      id: true,
      number: true,
      kind: true,
      name: true,
      role: true,
      alephaRole: true,
      environmentApp: true,
      environmentEnv: true,
    }),
  ),
});

export const personaGetParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});

export const personaGetResultSchema = personaResourceSchema.extend({
  comments: z.array(
    z.object({
      id: z.integer(),
      authorId: z.string().optional(),
      body: z.string(),
      createdAt: z.datetime(),
    }),
  ),
});

export const personaCreateParamsSchema = projectParamsSchema.extend(
  personaFieldsSchema.required({ name: true }).shape,
);

export const personaWriteResultSchema = personaResourceSchema;

export const personaUpdateParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  ...personaFieldsSchema.shape,
});

export const personaDeleteParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});

export const personaDeleteResultSchema = z.object({
  ok: z.boolean(),
  number: z.integer(),
});

export const personaCommentAddParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  body: z
    .string()
    .min(1)
    .describe(
      "The comment, in Markdown. `@name` reaches a project member's inbox.",
    ),
  as: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Your own name as a client, e.g. `claude-code`. Only labels the comment.",
    ),
});

export const personaCommentAddResultSchema = z.object({
  id: z.integer(),
  createdAt: z.datetime(),
});

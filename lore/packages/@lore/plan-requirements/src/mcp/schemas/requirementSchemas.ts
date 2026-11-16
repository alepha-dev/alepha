import { projectParamsSchema } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

import { releaseMoveSchema } from "../../api/schemas/releaseMoveSchema.ts";
import { requirementPrioritySchema } from "../../api/schemas/requirementPrioritySchema.ts";
import { requirementResourceSchema } from "../../api/schemas/requirementResourceSchema.ts";
import { requirementTypeSchema } from "../../api/schemas/requirementTypeSchema.ts";

const numberSchema = z
  .integer()
  .describe("The requirement's per-project number: 15 for #S15.");

const fieldsSchema = z.object({
  statement: z
    .string()
    .min(3)
    .max(240)
    .describe("The requirement, in one sentence.")
    .optional(),
  description: z.string().describe("More detail, in Markdown.").optional(),
  type: requirementTypeSchema
    .describe("functional, non_functional or constraint.")
    .optional(),
  priority: requirementPrioritySchema
    .describe("MoSCoW: must, should, could or wont.")
    .optional(),
  chapter: z
    .string()
    .max(120)
    .describe("The chapter, as the specification titles it: '3. Promotions'.")
    .optional(),
  paragraph: z.string().max(20).describe("Its paragraph: '3.2'.").optional(),
  source_folio_shortId: z
    .integer()
    .describe(
      "The folio it comes from (12 for #F12), when the project has Remember.",
    )
    .optional(),
  sourceAnchor: z
    .string()
    .max(200)
    .describe("The heading slug of its section in that folio.")
    .optional(),
});

export type RequirementFields = Infer<typeof fieldsSchema>;

export const requirementListParamsSchema = projectParamsSchema.extend({
  type: requirementTypeSchema.optional(),
  priority: requirementPrioritySchema.optional(),
});

export const requirementListResultSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      statement: z.string(),
      type: requirementTypeSchema,
      priority: requirementPrioritySchema,
      chapter: z.string().optional(),
      paragraph: z.string().optional(),
      status: z.string(),
      verifiedBy: z
        .array(z.string())
        .describe("The criteria verifying it: `#U7 C2`."),
      release: z
        .string()
        .optional()
        .describe("Its target release's tag, with (auto) or (by hand)."),
    }),
  ),
});

export const requirementGetParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});
export const requirementGetResultSchema = requirementResourceSchema;

export const requirementCreateParamsSchema = projectParamsSchema.extend(
  fieldsSchema.required({ statement: true }).shape,
);
export const requirementWriteResultSchema = requirementResourceSchema;

export const requirementUpdateParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  ...fieldsSchema.shape,
});

export const requirementDeleteParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
});
export const requirementDeleteResultSchema = z.object({
  ok: z.boolean(),
  number: z.integer(),
});

export const requirementSetReleaseParamsSchema = projectParamsSchema.extend({
  number: numberSchema,
  release_tag: z
    .string()
    .describe(
      "The release's tag (`2.4.0`). Pass an empty string to clear a release set by hand.",
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Apply even when a covering epic covers other requirements or sits in another release: read `moves` first.",
    ),
});

export const requirementSetReleaseResultSchema = z.object({
  applied: z
    .boolean()
    .describe(
      "false: nothing changed, read `moves` and call again with confirm: true.",
    ),
  moves: z.array(releaseMoveSchema),
  requirement: requirementResourceSchema,
});

export const criterionVerifyLinkParamsSchema = projectParamsSchema.extend({
  usecase_number: z.integer().describe("The use case: 7 for #U7."),
  key: z.string().describe("The criterion's key: C2."),
  requirement_number: z
    .integer()
    .optional()
    .describe("The requirement it verifies (15 for #S15). Omit to unlink."),
});

export const criterionVerifyLinkResultSchema = z.object({ ok: z.boolean() });

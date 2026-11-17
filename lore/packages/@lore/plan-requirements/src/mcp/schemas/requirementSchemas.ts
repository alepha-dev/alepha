import { projectParamsSchema } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

import { releaseMoveSchema } from "../../api/schemas/releaseMoveSchema.ts";
import { requirementCoverageSchema } from "../../api/schemas/requirementCoverageSchema.ts";
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
  metric_kind: z
    .enum(["vital", "availability", "latency", "api"])
    .describe(
      "Verify it by a measure instead of use cases: a web vital of the app copy's sigil, a monitor's availability or latency, or `api`, the latency of the app's server on the routes metric_path matches (2xx answers only). Needs an app built with Alepha.",
    )
    .optional(),
  metric_vital: z
    .enum(["lcp", "inp", "cls"])
    .describe("The web vital, for metric_kind vital.")
    .optional(),
  metric_percentile: z
    .integer()
    .min(1)
    .max(99)
    .describe("The percentile: 75 by default for a vital, 95 for a latency.")
    .optional(),
  metric_path: z
    .string()
    .max(200)
    .describe(
      "A path pattern of the sigil, `*` matching anything; for `api`, a pattern of the server's route patterns (`/api/orders/*`, `/api/orders/:id`).",
    )
    .optional(),
  metric_method: z
    .string()
    .max(16)
    .describe("The HTTP method, for metric_kind api: every method if absent.")
    .optional(),
  metric_monitor: z
    .uuid()
    .describe("The monitor's id; else the first monitor of the app copy.")
    .optional(),
  metric_app: z.string().max(100).describe("The app copy's app.").optional(),
  metric_env: z
    .string()
    .max(100)
    .describe("The app copy's env: production by default.")
    .optional(),
  metric_threshold: z
    .number()
    .describe(
      "Met at or below it (milliseconds, a CLS score) or, for availability, at or above it (a percentage).",
    )
    .optional(),
  metric_window_days: z
    .integer()
    .min(1)
    .max(90)
    .describe("The window, in days: 7 by default.")
    .optional(),
  metric_clear: z
    .boolean()
    .describe(
      "Remove the metric: the requirement is verified by use cases again.",
    )
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

export const requirementCoverageParamsSchema = projectParamsSchema.extend({
  release_tag: z
    .string()
    .optional()
    .describe(
      "A release's tag (2.4.0): its readiness and gaps. Omitted, the whole project.",
    ),
});
export const requirementCoverageResultSchema = requirementCoverageSchema;

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

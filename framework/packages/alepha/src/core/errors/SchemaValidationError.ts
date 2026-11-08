import { $error } from "../primitives/$error.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * A value that does not match its schema: the failure's message and the
 * path (JSON pointer, `""` for the root) it applies to.
 *
 * `issues` lists every failing path with its message (at most 50), in the
 * order the schema reported them. `path` and `message` are the first of
 * them, so a reader that only needs one failure keeps reading those.
 */
export const SchemaValidationError = $error({
  name: "SCHEMA_VALIDATION",
  schema: z.object({
    message: z.text({ size: "rich" }),
    path: z.text({ size: "long" }),
    issues: z
      .array(
        z.object({
          path: z.text({ size: "long" }),
          message: z.text({ size: "rich" }),
        }),
      )
      .optional(),
    params: z.any().optional(),
  }),
  default: { path: "" },
  message: (data) =>
    `Invalid input: ${data.message}${data.path ? ` at ${data.path}` : ""}`,
});

export type SchemaValidationError = InstanceType<typeof SchemaValidationError>;

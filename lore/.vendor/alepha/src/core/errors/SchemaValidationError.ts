import { $error } from "../primitives/$error.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * A value that does not match its schema: the failure's message and the
 * path (JSON pointer, `""` for the root) it applies to.
 */
export const SchemaValidationError = $error({
  name: "SCHEMA_VALIDATION",
  schema: z.object({
    message: z.text({ size: "rich" }),
    path: z.text({ size: "long" }),
    params: z.any().optional(),
  }),
  default: { path: "" },
  message: (data) =>
    `Invalid input: ${data.message}${data.path ? ` at ${data.path}` : ""}`,
});

export type SchemaValidationError = InstanceType<typeof SchemaValidationError>;

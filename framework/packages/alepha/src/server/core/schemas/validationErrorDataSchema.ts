import { z } from "alepha";

/**
 * What a `ValidationError` adds to an HTTP error's data: which part of the
 * request was refused, and every field that failed in it.
 *
 * Both are optional, so a hand-thrown `ValidationError` with neither stays
 * valid. Each issue is a JSON pointer into that part (`/address/city`, `""`
 * for the part as a whole) and its message, never the schema library's raw
 * issue.
 */
export const validationErrorDataSchema = z.object({
  part: z.enum(["params", "query", "headers", "body"]).optional(),
  issues: z
    .array(
      z.object({
        path: z.text({ size: "long" }),
        message: z.text({ size: "rich" }),
      }),
    )
    .optional(),
});

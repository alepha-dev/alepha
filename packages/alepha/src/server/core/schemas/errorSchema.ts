import { type Infer, z } from "alepha";

export const errorSchema = z
  .object({
    error: z.text({ description: "HTTP error name" }),
    status: z.integer().describe("HTTP status code"),
    message: z.text({
      description: "Short text which describe the error",
      size: "rich",
    }),
    details: z
      .text({
        description: "Detailed description of the error",
        size: "rich",
      })
      .optional(),
    data: z
      .record(z.text(), z.any())
      .describe(
        "Structured payload an error carries when the client has to act on " +
          "it rather than just display it. `details` is prose; this is the " +
          "machine-readable half. Used by the second-factor challenge.",
      )
      .optional(),
    requestId: z.text().optional(),
    cause: z
      .object({
        name: z.text(),
        message: z.text({
          description: "Cause Error message",
          size: "rich",
        }),
      })
      .optional(),
  })
  .meta({ title: "HttpError" })
  .describe("Generic response after a failed operation");

export type ErrorSchema = Infer<typeof errorSchema>;

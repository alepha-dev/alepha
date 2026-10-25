import { type Infer, z } from "alepha";

/**
 * A failed request's body: a declared error as `DeclaredError.toJSON` writes
 * it. The HTTP status is `data.status`.
 */
export const errorSchema = z
  .object({
    name: z.text({
      description: "The error's name, SCREAMING_SNAKE (NOT_FOUND)",
    }),
    message: z.text({
      description: "Short text which describe the error",
      size: "rich",
    }),
    data: z
      .record(z.text(), z.any())
      .describe(
        "The error's data: `status`, `requestId` and `details` for every " +
          "HTTP error, plus the fields its own schema declares.",
      )
      .optional(),
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

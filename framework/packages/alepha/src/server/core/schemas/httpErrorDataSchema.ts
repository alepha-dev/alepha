import { z } from "alepha";

/**
 * The data every HTTP error carries: its status, the request it answered,
 * and optional prose.
 */
export const httpErrorDataSchema = z.object({
  status: z.integer().describe("HTTP status code"),
  requestId: z.text().optional(),
  details: z
    .text({
      description: "Detailed description of the error",
      size: "rich",
    })
    .optional(),
});

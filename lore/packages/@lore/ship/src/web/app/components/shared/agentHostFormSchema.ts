import { z } from "alepha";

/**
 * The project's default Agent host picker (#Q3985): a host id, or the empty
 * string for none.
 */
export const agentHostFormSchema = z.object({
  hostId: z.text({ maxLength: 64 }),
});

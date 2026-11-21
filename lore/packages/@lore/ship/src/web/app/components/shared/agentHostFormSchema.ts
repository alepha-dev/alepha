import { z } from "alepha";

/**
 * The project's default Agent host picker (#Q3985): a host id, or the empty
 * string for none.
 */
export const agentHostFormSchema = z.object({
  hostId: z.text({ maxLength: 64 }),
  /**
   * The hosts a push job reaches beyond Anthropic and Lore (#Q3996), comma
   * separated; empty keeps the default list.
   */
  egress: z.text({ maxLength: 2000 }),
});

import { z } from "alepha";

/**
 * The hosts a push job reaches beyond Anthropic and Lore (#Q3996), comma
 * separated; empty keeps the default list. Edited from the default Agent
 * host's row of the project's Hosts tab since #Q4065.
 */
export const agentEgressFormSchema = z.object({
  egress: z.text({ maxLength: 2000 }),
});

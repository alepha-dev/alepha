import { projectParamsSchema } from "@lore/core/schemas";
import { hostJobToolSchema } from "@lore/core/schemas";
import { z } from "alepha";

// -----------------------------------------------------------------------------
// agent_hosts (#Q4225)
// -----------------------------------------------------------------------------

export const agentHostsParamsSchema = projectParamsSchema;

export const agentHostsResultSchema = z.object({
  hosts: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      status: z.string().optional(),
      checkedAt: z.string().optional(),
      error: z.string().optional(),
      agents: z.array(z.string()),
      tools: z.array(hostJobToolSchema),
    }),
  ),
});

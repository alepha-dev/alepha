import { type Infer, z } from "alepha";

/**
 * What a run of an agent automation started (#Q4226): its jobs, or why it
 * started none.
 */
export const agentAutomationRunResultSchema = z.object({
  jobIds: z.array(z.uuid()),
  skipped: z.string().optional(),
});

export type AgentAutomationRunResult = Infer<
  typeof agentAutomationRunResultSchema
>;

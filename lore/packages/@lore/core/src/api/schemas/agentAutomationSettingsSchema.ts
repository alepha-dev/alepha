import { type Infer, z } from "alepha";

/**
 * A project's settings for all its agent automations (#Q4230): whether they
 * are paused, and the daily ceiling on the builds they start.
 */
export const agentAutomationSettingsSchema = z.object({
  /** When every automation of the project was paused; absent, running. */
  pausedAt: z.string().optional(),
  /** Builds started by automations per day, 20 unless set. */
  buildsPerDay: z.integer().min(0).max(1000),
});

export type AgentAutomationSettings = Infer<
  typeof agentAutomationSettingsSchema
>;

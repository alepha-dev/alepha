import { automations } from "../entities/automations.ts";

/**
 * Owner-visible metadata only. No program, variables, baseline or run payload.
 */
export const automationDiagnosticResourceSchema = automations.schema.pick({
  id: true,
  title: true,
  authorUserId: true,
  enabled: true,
  health: true,
  reason: true,
  requiresApproval: true,
  revision: true,
  updatedAt: true,
});

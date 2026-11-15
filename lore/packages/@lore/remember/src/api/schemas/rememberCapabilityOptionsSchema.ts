import { type Infer, z } from "alepha";

/**
 * The switches inside the Remember capability: none since #Q3704. The one it
 * had, `agentSummary`, only revealed a folio's summary field; the summary is
 * edited from Folio > Edit summary... in every project now, so the switch,
 * its settings page and its stored values went.
 *
 * See {@link planCapabilityOptionsSchema} for why this schema is lax rather
 * than closed.
 */
export const rememberCapabilityOptionsSchema = z.object({});

export type RememberCapabilityOptions = Infer<
  typeof rememberCapabilityOptionsSchema
>;

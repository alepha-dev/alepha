import { type Infer, z } from "alepha";

/**
 * The switches inside the Knowledge capability.
 *
 * One so far, and it is why Knowledge contributes no section to the creation
 * wizard: `agentSummary` reveals the "Summary for agents" field on a folio,
 * which is chrome between the title and the first line for a human reader and
 * is written by MCP whether the switch is on or off. Hiding it never stops it
 * being persisted. That is a preference adopted later, not a decision about
 * what the project is.
 *
 * See {@link workCapabilityOptionsSchema} for why every option defaults to
 * `false` and why this schema is lax rather than closed.
 */
export const knowledgeCapabilityOptionsSchema = z.object({
  agentSummary: z.boolean().default(false),
});

export type KnowledgeCapabilityOptions = Infer<
  typeof knowledgeCapabilityOptionsSchema
>;

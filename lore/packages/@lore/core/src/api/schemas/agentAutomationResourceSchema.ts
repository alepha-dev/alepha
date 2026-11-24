import type { Infer } from "alepha";

import { agentAutomations } from "../entities/agentAutomations.ts";

/**
 * An agent automation as the CLI, MCP and its page read it (#Q4226): the row
 * whole, since it holds no secret. A text automation's words are shown to
 * whoever reads the project's hosts.
 */
export const agentAutomationResourceSchema = agentAutomations.schema;

export type AgentAutomationResource = Infer<
  typeof agentAutomationResourceSchema
>;

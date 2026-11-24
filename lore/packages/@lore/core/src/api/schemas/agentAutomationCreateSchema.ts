import type { Infer } from "alepha";

import { agentAutomations } from "../entities/agentAutomations.ts";
import { agentAutomationWriteSchema } from "./agentAutomationWriteSchema.ts";

/**
 * Creating an agent automation (#Q4226): its name and its prompt, the rest
 * defaulted (by hand only, enabled, no "only if" check).
 */
export const agentAutomationCreateSchema = agentAutomationWriteSchema.extend({
  name: agentAutomations.schema.shape.name,
  promptKind: agentAutomations.schema.shape.promptKind,
});

export type AgentAutomationCreate = Infer<typeof agentAutomationCreateSchema>;

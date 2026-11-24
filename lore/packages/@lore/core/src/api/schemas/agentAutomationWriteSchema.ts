import { type Infer, z } from "alepha";

import { agentAutomations } from "../entities/agentAutomations.ts";
import { agentRunSchema } from "./agentRunSchema.ts";

/**
 * What a write of an agent automation may set (#Q4226), every field
 * optional: an update changes what it names. `host`, `agent`, `model` and
 * `promptText` take an empty string to clear them. Their formats are a run
 * by hand's (`agentRunSchema`).
 */
export const agentAutomationWriteSchema = agentAutomations.schema
  .pick({
    name: true,
    promptKind: true,
    trigger: true,
    onlyIfWork: true,
    enabled: true,
    eventKeys: true,
    settleSeconds: true,
    schedule: true,
    dailyHour: true,
    autoMerge: true,
    concurrency: true,
  })
  .partial()
  .extend({
    promptText: z
      .union([agentAutomations.schema.shape.promptText.unwrap(), z.literal("")])
      .optional(),
    host: z
      .union([agentRunSchema.shape.host.unwrap(), z.literal("")])
      .optional(),
    agent: z
      .union([agentRunSchema.shape.agent.unwrap(), z.literal("")])
      .optional(),
    model: z
      .union([agentRunSchema.shape.model.unwrap(), z.literal("")])
      .optional(),
  });

export type AgentAutomationWrite = Infer<typeof agentAutomationWriteSchema>;

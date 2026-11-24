import { type Infer, z } from "alepha";

import { agentAutomations } from "../entities/agentAutomations.ts";
import { agentRunSchema, agentRunSourceSchema } from "./agentRunSchema.ts";

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
    maxRunsPerHour: true,
    maxRunsPerDay: true,
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
    /** Its jobs' source and ref (#E173); an empty string clears either. */
    source: z
      .union([agentRunSourceSchema.shape.source.unwrap(), z.literal("")])
      .optional(),
    ref: z
      .union([agentRunSourceSchema.shape.ref.unwrap(), z.literal("")])
      .optional(),
    /**
     * When it runs, in one word, as the CLI and MCP take it (#Q4231):
     * `manual`, `event:<key>[,<key>]`, `hourly`, `6h` or `daily@<utc-hour>`.
     * Sets `trigger`, `eventKeys`, `schedule` and `dailyHour` together.
     */
    on: z.string().max(1024).optional(),
  });

export type AgentAutomationWrite = Infer<typeof agentAutomationWriteSchema>;

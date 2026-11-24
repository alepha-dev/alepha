import { type Infer, z } from "alepha";

import { agentAutomationCreateSchema } from "./agentAutomationCreateSchema.ts";

/**
 * The automations page's form (#Q4231): the create action's own fields, as
 * the dialog offers them. The free texts are plain strings here, an empty
 * one meaning none (the action takes `""` the same way); `on` is the
 * one-word trigger the CLI takes.
 */
export const agentAutomationFormSchema = agentAutomationCreateSchema
  .pick({
    name: true,
    promptKind: true,
    onlyIfWork: true,
    autoMerge: true,
    concurrency: true,
  })
  .extend({
    promptText: z.string().max(131_072).optional(),
    host: z.string().max(64).optional(),
    agent: z.string().max(32).optional(),
    model: z.string().max(96).optional(),
    room: z.string().max(64).optional(),
    on: z.string().max(1024).optional(),
  });

export type AgentAutomationForm = Infer<typeof agentAutomationFormSchema>;

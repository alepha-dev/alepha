import { type Infer, z } from "alepha";

export const automationAdoptionBodySchema = z
  .object({
    confirm: z.literal(true),
    automationId: z.uuid().optional(),
    expectedRevision: z.integer().nonnegative().optional(),
  })
  .strict();
export type AutomationAdoptionBody = Infer<typeof automationAdoptionBodySchema>;

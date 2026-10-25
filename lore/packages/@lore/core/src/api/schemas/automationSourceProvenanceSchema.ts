import { type Infer, z } from "alepha";

export const automationSourceProvenanceSchema = z
  .object({
    mode: z.enum(["prospective", "historical", "live", "schedule"]),
    key: z.string().max(128),
    actorUserId: z.uuid().optional(),
    id: z.string().max(255).optional(),
    occurredAt: z.datetime().optional(),
    omitted: z.array(z.string().max(128)).max(64).optional(),
  })
  .strict();
export type AutomationSourceProvenance = Infer<
  typeof automationSourceProvenanceSchema
>;

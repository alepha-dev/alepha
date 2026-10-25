import { type Infer, z } from "alepha";

export const blightRuleResourceSchema = z.object({
  id: z.integer(),
  pattern: z.string(),
  createdAt: z.string(),
});

export type BlightRuleResource = Infer<typeof blightRuleResourceSchema>;

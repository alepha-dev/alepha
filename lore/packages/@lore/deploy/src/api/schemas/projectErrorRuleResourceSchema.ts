import { type Infer, z } from "alepha";

export const projectErrorRuleResourceSchema = z.object({
  id: z.integer(),
  pattern: z.string(),
  createdAt: z.string(),
});

export type ProjectErrorRuleResource = Infer<
  typeof projectErrorRuleResourceSchema
>;

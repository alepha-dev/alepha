import { type Infer, z } from "alepha";

/**
 * Identity plus version prevents a deleted/recreated key reusing version zero.
 */
export const automationVariableApprovalSchema = z
  .object({
    id: z.uuid(),
    key: z.string().max(64),
    version: z.integer().nonnegative(),
  })
  .strict();
export type AutomationVariableApproval = Infer<
  typeof automationVariableApprovalSchema
>;

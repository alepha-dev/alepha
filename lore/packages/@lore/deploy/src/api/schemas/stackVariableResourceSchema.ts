import type { Infer } from "alepha";

import { stackVariables } from "../entities/stackVariables.ts";

/**
 * What a read path may say about a stack variable: never its value. A `pick`
 * allowlist, so a column added later cannot ride along.
 */
export const stackVariableResourceSchema = stackVariables.schema.pick({
  id: true,
  key: true,
  valuePrefix: true,
  generated: true,
  updatedAt: true,
  updatedBy: true,
});

export type StackVariableResource = Infer<typeof stackVariableResourceSchema>;

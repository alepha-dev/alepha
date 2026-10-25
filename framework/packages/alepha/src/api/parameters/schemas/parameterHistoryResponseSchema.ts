import { type Infer, z } from "alepha";

import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameter history response schema.
 */
export const parameterHistoryResponseSchema = z.object({
  versions: z.array(parameterResponseSchema),
});

export type ParameterHistoryResponse = Infer<
  typeof parameterHistoryResponseSchema
>;

import { type Infer, z } from "alepha";

import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

export const automationVariableSetBodySchema = z
  .object({
    id: z.uuid().optional(),
    version: z.integer().nonnegative().optional(),
    value: automationVariableValueSchema,
  })
  .strict()
  .refine(
    (value) => (value.id === undefined) === (value.version === undefined),
    { message: "An existing variable requires both identity and version" },
  );
export type AutomationVariableSetBody = Infer<
  typeof automationVariableSetBodySchema
>;

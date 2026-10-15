import { z } from "alepha";

import { automationVariables } from "../entities/automationVariables.ts";
import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

export const automationCatalogVariableSchema = automationVariables.schema
  .pick({ key: true, version: true })
  .extend({
    kind: automationVariableValueSchema.shape.kind,
    available: z.boolean(),
    reason: z.string().optional(),
    value: automationVariableValueSchema.optional(),
  });

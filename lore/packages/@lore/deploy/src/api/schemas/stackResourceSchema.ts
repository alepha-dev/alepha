import type { Infer } from "alepha";
import { z } from "alepha";

import { stacks } from "../entities/stacks.ts";
import { stackEnvironmentResourceSchema } from "./stackEnvironmentResourceSchema.ts";

/**
 * One stack and its environments. `latestRevision` is the newest revision
 * number uploaded, absent before the first.
 */
export const stackResourceSchema = stacks.schema
  .omit({ createdBy: true })
  .extend({
    environments: z.array(stackEnvironmentResourceSchema),
    latestRevision: z.integer().optional(),
  });

export type StackResource = Infer<typeof stackResourceSchema>;

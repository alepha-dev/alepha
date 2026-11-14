import { z } from "alepha";

import { monitorResourceSchema } from "./monitorResourceSchema.ts";
export const monitorCreateResourceSchema = z.object({
  monitor: monitorResourceSchema,
  token: z.string().optional(),
});

import { z } from "alepha";

import { monitorWindowSchema } from "./monitorWindowSchema.ts";
export const monitorUptimeCardSchema = z.object({
  window: monitorWindowSchema,
  uptimePct: z.number().nullable(),
});

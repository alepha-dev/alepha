import { z } from "alepha";

import { monitorWindowSchema } from "./monitorWindowSchema.ts";
export const monitorListQuerySchema = z.object({
  window: monitorWindowSchema.default("24h"),
});

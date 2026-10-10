import { type Infer, z } from "alepha";

import { otaCohortResourceSchema } from "./otaCohortResourceSchema.ts";

/**
 * A channel as the admin sees it, its cohorts as a list.
 */
export const otaChannelResourceSchema = z.object({
  id: z.uuid(),
  appRef: z.uuid(),
  name: z.text({ maxLength: 64 }),
  allowSelfAssign: z.boolean(),
  isDefault: z.boolean(),
  cohorts: z.array(otaCohortResourceSchema),
});

export type OtaChannelResource = Infer<typeof otaChannelResourceSchema>;

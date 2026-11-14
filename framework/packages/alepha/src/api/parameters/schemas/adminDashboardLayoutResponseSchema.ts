import type { Infer } from "alepha";
import { z } from "alepha";

import { adminDashboardLayoutSchema } from "./adminDashboardLayoutSchema.ts";

export const adminDashboardLayoutResponseSchema = z.object({
  layout: adminDashboardLayoutSchema,
  /**
   * The layout parameter's latest version number, 0 when it was never saved.
   * A save sends it back as `expectedVersion`.
   */
  version: z.integer(),
});

export type AdminDashboardLayoutResponse = Infer<
  typeof adminDashboardLayoutResponseSchema
>;

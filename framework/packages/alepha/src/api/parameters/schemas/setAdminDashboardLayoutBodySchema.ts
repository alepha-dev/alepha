import type { Infer } from "alepha";
import { z } from "alepha";

import { adminDashboardLayoutSchema } from "./adminDashboardLayoutSchema.ts";

export const setAdminDashboardLayoutBodySchema = z.object({
  layout: adminDashboardLayoutSchema,
  /**
   * The version the admin's edit started from, as `getAdminDashboardLayout`
   * returned it. Another admin's save in between makes this one a 409.
   */
  expectedVersion: z.integer().min(0),
});

export type SetAdminDashboardLayoutBody = Infer<
  typeof setAdminDashboardLayoutBodySchema
>;

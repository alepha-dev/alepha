import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * Which admin dashboard tiles show, and in what order. Deployment-wide: one
 * layout for every admin.
 *
 * Ids are plain strings: the server does not know the tile catalog, which
 * lives in the browser, and the dashboard drops an id its catalog no longer
 * has. An empty `tiles` means "the code defaults".
 */
export const adminDashboardLayoutSchema = z.object({
  tiles: z
    .array(
      z.object({
        id: z.text({ maxLength: 120 }),
        enabled: z.boolean(),
      }),
    )
    .max(200),
});

export type AdminDashboardLayout = Infer<typeof adminDashboardLayoutSchema>;

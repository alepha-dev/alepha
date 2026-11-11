import { type Infer, z } from "alepha";

import { USER_DOCK_CAP } from "./userDockCap.ts";

/**
 * The caller's dock as every dock action answers it: the pinned project ids,
 * in order, already narrowed to live memberships of unarchived projects.
 */
export const userDockSchema = z.object({
  projectIds: z.array(z.integer()).max(USER_DOCK_CAP),
});

export type UserDockResource = Infer<typeof userDockSchema>;

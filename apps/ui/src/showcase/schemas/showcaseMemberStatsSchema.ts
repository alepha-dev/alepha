import { z } from "alepha";

export const showcaseMemberStatsSchema = z.object({
  total: z.integer(),
  active: z.integer(),
  teams: z.integer(),
});

import type { Infer } from "alepha";
import { z } from "alepha";

export const userStatsSchema = z.object({
  /**
   * Every user of the realm, the same number `findUsers` reports.
   */
  total: z.integer(),
  /**
   * Users created in the current window and in the one before it.
   */
  signups: z.object({
    current: z.integer(),
    previous: z.integer(),
    /**
     * The current window's first instant, inclusive (UTC midnight).
     */
    from: z.datetime(),
    /**
     * The current window's end, exclusive: the next UTC midnight.
     */
    to: z.datetime(),
  }),
  /**
   * Distinct users who signed in or refreshed a session within
   * `connectedHours`. Equal to `findUsers({ activeWithinHours })`'s total.
   */
  connected: z.integer(),
  windowDays: z.integer(),
  connectedHours: z.integer(),
});

export type UserStats = Infer<typeof userStatsSchema>;

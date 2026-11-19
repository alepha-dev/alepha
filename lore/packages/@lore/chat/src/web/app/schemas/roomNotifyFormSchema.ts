import { z } from "alepha";

/**
 * The members panel's notify level (#E161, #Q3955): mentions only, or
 * muted.
 */
export const roomNotifyFormSchema = z.object({
  level: z.enum(["mentions", "muted"]),
});

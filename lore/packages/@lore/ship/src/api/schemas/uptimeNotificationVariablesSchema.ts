import { z } from "alepha";
export const uptimeNotificationVariablesSchema = z.object({
  monitorName: z.string(),
  target: z.string(),
  cause: z.string(),
  error: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationSecs: z.integer().min(0),
  detailsUrl: z.string(),
});

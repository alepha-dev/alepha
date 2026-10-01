import { z } from "alepha";

export const healthSchema = z.object({
  message: z.text(),
  uptime: z.number(),
  date: z.datetime(),
  ready: z.boolean(),
});

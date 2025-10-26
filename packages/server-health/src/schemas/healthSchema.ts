import { t } from "@alepha/core";

export const healthSchema = t.object({
  message: t.text(),
  uptime: t.number(),
  date: t.datetime(),
  ready: t.boolean(),
});

import { t } from "alepha";

export const healthSchema = t.object({
  message: t.text(),
  uptime: t.number(),
  date: t.datetime(),
  ready: t.boolean(),
});

import { type Static, t } from "@alepha/core";

export const logEntrySchema = t.object({
  level: t.enum(["SILENT", "TRACE", "DEBUG", "INFO", "WARN", "ERROR"]),
  message: t.text({
    size: "rich",
  }),
  service: t.text(),
  module: t.text(),
  context: t.optional(t.text()),
  app: t.optional(t.text()),
  data: t.optional(t.any()),
  timestamp: t.datetime(),
});

export type LogEntry = Static<typeof logEntrySchema>;

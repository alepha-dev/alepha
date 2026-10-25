import { type Infer, z } from "alepha";

export const logEntrySchema = z.object({
  level: z.enum(["SILENT", "TRACE", "DEBUG", "INFO", "WARN", "ERROR"]),
  message: z.text({
    size: "rich",
  }),
  service: z.text(),
  module: z.text(),
  context: z.text().optional(),
  app: z.text().optional(),
  data: z.any().optional(),
  timestamp: z.number(),
});

export type LogEntry = Infer<typeof logEntrySchema>;

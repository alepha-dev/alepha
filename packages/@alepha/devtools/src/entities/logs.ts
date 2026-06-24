import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const logs = $entity({
  name: "logs",
  schema: z.object({
    id: db.primaryKey(),
    level: z
      .enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"])
      .meta({ mode: "text" }),
    message: z.text({
      size: "rich",
    }),
    service: z.text(),
    module: z.text(),
    context: z.text().optional(),
    app: z.text().optional(),
    data: z.json().optional(),
    timestamp: z.integer(),
  }),
});

export type DevLogEntry = Static<typeof logs.schema>;

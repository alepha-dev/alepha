import { type Static, t } from "alepha";
import { $entity, pg } from "@alepha/orm";

export const logs = $entity({
  name: "logs",
  schema: t.object({
    id: pg.primaryKey(),
    level: t.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]),
    message: t.text({
      size: "rich",
    }),
    service: t.text(),
    module: t.text(),
    context: t.optional(t.text()),
    app: t.optional(t.text()),
    data: t.optional(t.json()),
    timestamp: t.datetime(),
  }),
});

export type DevLogEntry = Static<typeof logs.schema>;

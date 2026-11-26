import type { Infer, ZType } from "alepha";
import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres schema type.
 */
export const schema = <TDocument extends ZType>(
  name: string,
  document: TDocument,
) =>
  customType<{
    data: Infer<TDocument>;
    driverData: string;
    config: { document: TDocument };
    configRequired: true;
  }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(value),
    // A driver that parses `jsonb` itself hands a JSON string document back
    // as a plain string ("done"), which is not JSON text: it is the value.
    fromDriver: (value: TDocument | string) => {
      if (!value || typeof value !== "string") {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    },
  })(name, { document }).$type<Infer<TDocument>>();

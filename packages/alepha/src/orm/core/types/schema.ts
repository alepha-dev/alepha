import type { Static, TSchema } from "alepha";
import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres schema type.
 */
export const schema = <TDocument extends TSchema>(
  name: string,
  document: TDocument,
) =>
  customType<{
    data: Static<TDocument>;
    driverData: string;
    config: { document: TDocument };
    configRequired: true;
  }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value: TDocument | string) =>
      value && typeof value === "string" ? JSON.parse(value) : value,
  })(name, { document }).$type<Static<TDocument>>();

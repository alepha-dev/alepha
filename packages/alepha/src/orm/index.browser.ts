import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

// ---------------------------------------------------------------------------------------------------------------------

export {
  type Page,
  type PageQuery,
  pageQuerySchema,
  pageSchema,
} from "alepha";
export * from "./errors/DbEntityNotFoundError.ts";
export * from "./helpers/parseQueryString.ts";
export * from "./helpers/pgAttr.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./primitives/$entity.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./schemas/legacyIdSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaPostgres = $module({
  name: "alepha.postgres",
  primitives: [],
  services: [AlephaDateTime],
});

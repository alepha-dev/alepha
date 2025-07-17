import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/EntityNotFoundError.ts";
export * from "./helpers/nullToUndefined.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./schemas/entitySchema.ts";
export * from "./schemas/pageQuerySchema.ts";
export * from "./schemas/pageSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaPostgres = $module({
	name: "alepha.postgres",
	descriptors: [],
	services: [],
});

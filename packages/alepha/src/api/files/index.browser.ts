import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export type * from "./controllers/AdminFileStatsController.ts";
export type * from "./controllers/FileController.ts";
export * from "./entities/files.ts";
export * from "./schemas/fileQuerySchema.ts";
export * from "./schemas/fileResourceSchema.ts";
export * from "./schemas/storageStatsSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiFiles = $module({
  name: "alepha.api.files",
  services: [],
});

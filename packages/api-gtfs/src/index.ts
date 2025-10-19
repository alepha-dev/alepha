import { $module } from "@alepha/core";
import { AlephaServerMultipart } from "@alepha/server-multipart";
import { GtfsDatasetController } from "./controllers/GtfsDatasetController.ts";
import { GtfsPlannerController } from "./controllers/GtfsPlannerController.ts";
import { GtfsTopologyController } from "./controllers/GtfsTopologyController.ts";
import { GtfsDatabaseService } from "./services/GtfsDatabaseService.ts";
import { GtfsImportService } from "./services/GtfsImportService.ts";
import { GtfsJourneyService } from "./services/GtfsJourneyService.ts";
import { GtfsQueryService } from "./services/GtfsQueryService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/GtfsDatasetController.ts";
export * from "./controllers/GtfsPlannerController.ts";
export * from "./controllers/GtfsTopologyController.ts";
export * from "./schemas/gtfsCalendarDateSchema.ts";
export * from "./schemas/gtfsCalendarSchema.ts";
export * from "./schemas/gtfsImportResultSchema.ts";
export * from "./schemas/gtfsRouteSchema.ts";
export * from "./schemas/gtfsStopSchema.ts";
export * from "./schemas/gtfsStopTimeSchema.ts";
export * from "./schemas/gtfsTripSchema.ts";
export * from "./services/GtfsDatabaseService.ts";
export * from "./services/GtfsImportService.ts";
export * from "./services/GtfsJourneyService.ts";
export * from "./services/GtfsQueryService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides GTFS (General Transit Feed Specification) API endpoints for Alepha applications.
 *
 * This module includes:
 * - GTFS data import from ZIP files
 * - Query APIs for stops, routes, trips, stop times, calendar data
 * - Full-text search for stops and routes
 * - Journey planning with origin, destination, and departure time
 * - Support for multiple GTFS datasets
 *
 * @module alepha.api.gtfs
 */
export const AlephaApiGTFS = $module({
	name: "alepha.api.gtfs",
	services: [
		AlephaServerMultipart,
		GtfsDatabaseService,
		GtfsImportService,
		GtfsQueryService,
		GtfsJourneyService,
		GtfsDatasetController,
		GtfsTopologyController,
		GtfsPlannerController,
	],
});

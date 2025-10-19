import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { gtfsCalendarDateSchema } from "../schemas/gtfsCalendarDateSchema.ts";
import { gtfsCalendarSchema } from "../schemas/gtfsCalendarSchema.ts";
import { gtfsRouteSchema } from "../schemas/gtfsRouteSchema.ts";
import { gtfsStopSchema } from "../schemas/gtfsStopSchema.ts";
import { gtfsStopTimeSchema } from "../schemas/gtfsStopTimeSchema.ts";
import { gtfsTripSchema } from "../schemas/gtfsTripSchema.ts";
import { GtfsQueryService } from "../services/GtfsQueryService.ts";

/**
 * Controller for querying GTFS topology resources (stops, routes, trips, etc.)
 */
export class GtfsTopologyController {
	private readonly queryService = $inject(GtfsQueryService);

	private readonly url = "/gtfs";
	private readonly group = "gtfs";

	// ====================================
	// Stops Endpoints
	// ====================================

	/**
	 * Query stops with filtering, sorting, and pagination
	 */
	public queryStops = $action({
		path: `${this.url}/stops`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				search: t.optional(t.string({ description: "Full-text search query" })),
				locationType: t.optional(
					t.int({ description: "Filter by location type" }),
				),
				wheelchairBoarding: t.optional(
					t.int({ description: "Filter by wheelchair accessibility" }),
				),
				nearLat: t.optional(
					t.number({ description: "Latitude for distance-based search" }),
				),
				nearLon: t.optional(
					t.number({ description: "Longitude for distance-based search" }),
				),
				radius: t.optional(
					t.number({ description: "Search radius in kilometers" }),
				),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "stop_name" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsStopSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryStops(query.dataset, query);
		},
	});

	/**
	 * Get a single stop by ID
	 */
	public getStop = $action({
		path: `${this.url}/stops/:stopId`,
		method: "GET",
		group: this.group,
		schema: {
			params: t.object({
				stopId: t.string(),
			}),
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
			}),
			response: gtfsStopSchema,
		},
		handler: async ({ params, query }) => {
			const stop = this.queryService.getStop(query.dataset, params.stopId);
			if (!stop) {
				throw new Error(`Stop not found: ${params.stopId}`);
			}
			return stop;
		},
	});

	// ====================================
	// Routes Endpoints
	// ====================================

	/**
	 * Query routes with filtering, sorting, and pagination
	 */
	public queryRoutes = $action({
		path: `${this.url}/routes`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				search: t.optional(t.string({ description: "Full-text search query" })),
				routeType: t.optional(t.int({ description: "Filter by route type" })),
				agencyId: t.optional(t.string({ description: "Filter by agency ID" })),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "route_short_name" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsRouteSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryRoutes(query.dataset, query);
		},
	});

	/**
	 * Get a single route by ID
	 */
	public getRoute = $action({
		path: `${this.url}/routes/:routeId`,
		method: "GET",
		group: this.group,
		schema: {
			params: t.object({
				routeId: t.string(),
			}),
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
			}),
			response: gtfsRouteSchema,
		},
		handler: async ({ params, query }) => {
			const route = this.queryService.getRoute(query.dataset, params.routeId);
			if (!route) {
				throw new Error(`Route not found: ${params.routeId}`);
			}
			return route;
		},
	});

	// ====================================
	// Trips Endpoints
	// ====================================

	/**
	 * Query trips with filtering, sorting, and pagination
	 */
	public queryTrips = $action({
		path: `${this.url}/trips`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				routeId: t.optional(t.string({ description: "Filter by route ID" })),
				serviceId: t.optional(
					t.string({ description: "Filter by service ID" }),
				),
				directionId: t.optional(t.int({ description: "Filter by direction" })),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "trip_id" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsTripSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryTrips(query.dataset, query);
		},
	});

	/**
	 * Get a single trip by ID
	 */
	public getTrip = $action({
		path: `${this.url}/trips/:tripId`,
		method: "GET",
		group: this.group,
		schema: {
			params: t.object({
				tripId: t.string(),
			}),
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
			}),
			response: gtfsTripSchema,
		},
		handler: async ({ params, query }) => {
			const trip = this.queryService.getTrip(query.dataset, params.tripId);
			if (!trip) {
				throw new Error(`Trip not found: ${params.tripId}`);
			}
			return trip;
		},
	});

	// ====================================
	// Stop Times Endpoints
	// ====================================

	/**
	 * Query stop times with filtering, sorting, and pagination
	 */
	public queryStopTimes = $action({
		path: `${this.url}/stop-times`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				tripId: t.optional(t.string({ description: "Filter by trip ID" })),
				stopId: t.optional(t.string({ description: "Filter by stop ID" })),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "stop_sequence" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsStopTimeSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryStopTimes(query.dataset, query);
		},
	});

	// ====================================
	// Calendar Endpoints
	// ====================================

	/**
	 * Query calendar with filtering, sorting, and pagination
	 */
	public queryCalendar = $action({
		path: `${this.url}/calendar`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				serviceId: t.optional(
					t.string({ description: "Filter by service ID" }),
				),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "service_id" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsCalendarSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryCalendar(query.dataset, query);
		},
	});

	/**
	 * Query calendar dates with filtering, sorting, and pagination
	 */
	public queryCalendarDates = $action({
		path: `${this.url}/calendar-dates`,
		method: "GET",
		group: this.group,
		schema: {
			query: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				serviceId: t.optional(
					t.string({ description: "Filter by service ID" }),
				),
				date: t.optional(
					t.string({ description: "Filter by date (YYYYMMDD)" }),
				),
				exceptionType: t.optional(
					t.int({ description: "Filter by exception type" }),
				),
				limit: t.optional(t.int({ default: 100 })),
				offset: t.optional(t.int({ default: 0 })),
				sortBy: t.optional(t.string({ default: "date" })),
				sortOrder: t.optional(t.enum(["asc", "desc"], { default: "asc" })),
			}),
			response: t.object({
				data: t.array(gtfsCalendarDateSchema),
				total: t.int(),
				limit: t.int(),
				offset: t.int(),
			}),
		},
		handler: async ({ query }) => {
			return this.queryService.queryCalendarDates(query.dataset, query);
		},
	});
}

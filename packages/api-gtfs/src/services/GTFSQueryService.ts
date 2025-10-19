import { $inject } from "@alepha/core";
import type { GTFSCalendarDate } from "../schemas/gtfsCalendarDateSchema.ts";
import type { GTFSCalendar } from "../schemas/gtfsCalendarSchema.ts";
import type { GTFSRoute } from "../schemas/gtfsRouteSchema.ts";
import type { GTFSStop } from "../schemas/gtfsStopSchema.ts";
import type { GTFSStopTime } from "../schemas/gtfsStopTimeSchema.ts";
import type { GTFSTrip } from "../schemas/gtfsTripSchema.ts";
import { GtfsDatabaseService } from "./GtfsDatabaseService.ts";

export interface QueryOptions {
	limit?: number;
	offset?: number;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}

export interface StopQueryOptions extends QueryOptions {
	search?: string;
	locationType?: number;
	wheelchairBoarding?: number;
	nearLat?: number;
	nearLon?: number;
	radius?: number; // in kilometers
}

export interface RouteQueryOptions extends QueryOptions {
	search?: string;
	routeType?: number;
	agencyId?: string;
}

export interface TripQueryOptions extends QueryOptions {
	routeId?: string;
	serviceId?: string;
	directionId?: number;
}

export interface StopTimeQueryOptions extends QueryOptions {
	tripId?: string;
	stopId?: string;
}

export interface CalendarQueryOptions extends QueryOptions {
	serviceId?: string;
}

export interface CalendarDateQueryOptions extends QueryOptions {
	serviceId?: string;
	date?: string;
	exceptionType?: number;
}

export interface PaginatedResult<T> {
	data: T[];
	total: number;
	limit: number;
	offset: number;
}

/**
 * Service for querying GTFS data
 */
export class GtfsQueryService {
	private readonly dbService = $inject(GtfsDatabaseService);

	/**
	 * Resolve dataset name to use (default to first loaded dataset if not specified)
	 */
	private resolveDataset(dataset?: string): string {
		if (dataset) {
			return dataset;
		}

		const defaultDataset = this.dbService.getDefaultDataset();
		if (!defaultDataset) {
			throw new Error(
				"No GTFS datasets available. Please import a dataset first.",
			);
		}

		return defaultDataset;
	}

	/**
	 * Query stops with filtering, sorting, and pagination
	 */
	public queryStops(
		dataset: string | undefined,
		options: StopQueryOptions = {},
	): PaginatedResult<GTFSStop> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			search,
			locationType,
			wheelchairBoarding,
			nearLat,
			nearLon,
			radius,
			limit = 100,
			offset = 0,
			sortBy = "stop_name",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		// Full-text search
		if (search) {
			whereClause += ` AND stop_id IN (
				SELECT stop_id FROM stops_fts WHERE stops_fts MATCH ?
			)`;
			// Quote the search term for phrase search to avoid FTS5 syntax errors
			params.push(`"${search.replace(/"/g, '""')}"`);
		}

		// Location type filter
		if (locationType !== undefined) {
			whereClause += " AND location_type = ?";
			params.push(locationType);
		}

		// Wheelchair boarding filter
		if (wheelchairBoarding !== undefined) {
			whereClause += " AND wheelchair_boarding = ?";
			params.push(wheelchairBoarding);
		}

		// Save WHERE params before adding SELECT distance params
		const whereParams = [...params];

		// Distance-based filtering
		let selectClause = "SELECT *";
		let selectParams: any[] = [];
		let orderByClause = `ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}`;

		if (nearLat !== undefined && nearLon !== undefined) {
			// Calculate distance using Haversine formula
			selectClause = `
				SELECT *,
				(6371 * acos(
					cos(radians(?)) * cos(radians(stop_lat)) *
					cos(radians(stop_lon) - radians(?)) +
					sin(radians(?)) * sin(radians(stop_lat))
				)) as distance
			`;
			selectParams = [nearLat, nearLon, nearLat];

			if (radius !== undefined) {
				whereClause +=
					" AND (6371 * acos(cos(radians(?)) * cos(radians(stop_lat)) * cos(radians(stop_lon) - radians(?)) + sin(radians(?)) * sin(radians(stop_lat)))) <= ?";
				whereParams.push(nearLat, nearLon, nearLat, radius);
			}

			orderByClause = "ORDER BY distance ASC";
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM stops ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...whereParams) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			${selectClause}
			FROM stops
			${whereClause}
			${orderByClause}
			LIMIT ? OFFSET ?
		`;
		const dataParams = [...selectParams, ...whereParams, limit, offset];

		const rows = db.prepare(dataQuery).all(...dataParams) as any[];

		return {
			data: rows.map((row) => this.mapStopRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Query routes with filtering, sorting, and pagination
	 */
	public queryRoutes(
		dataset: string | undefined,
		options: RouteQueryOptions = {},
	): PaginatedResult<GTFSRoute> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			search,
			routeType,
			agencyId,
			limit = 100,
			offset = 0,
			sortBy = "route_short_name",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		// Full-text search
		if (search) {
			whereClause += ` AND route_id IN (
				SELECT route_id FROM routes_fts WHERE routes_fts MATCH ?
			)`;
			// Quote the search term for phrase search to avoid FTS5 syntax errors
			params.push(`"${search.replace(/"/g, '""')}"`);
		}

		// Route type filter
		if (routeType !== undefined) {
			whereClause += " AND route_type = ?";
			params.push(routeType);
		}

		// Agency filter
		if (agencyId) {
			whereClause += " AND agency_id = ?";
			params.push(agencyId);
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM routes ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...params) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			SELECT *
			FROM routes
			${whereClause}
			ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}
			LIMIT ? OFFSET ?
		`;
		params.push(limit, offset);

		const rows = db.prepare(dataQuery).all(...params) as any[];

		return {
			data: rows.map((row) => this.mapRouteRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Query trips with filtering, sorting, and pagination
	 */
	public queryTrips(
		dataset: string | undefined,
		options: TripQueryOptions = {},
	): PaginatedResult<GTFSTrip> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			routeId,
			serviceId,
			directionId,
			limit = 100,
			offset = 0,
			sortBy = "trip_id",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		if (routeId) {
			whereClause += " AND route_id = ?";
			params.push(routeId);
		}

		if (serviceId) {
			whereClause += " AND service_id = ?";
			params.push(serviceId);
		}

		if (directionId !== undefined) {
			whereClause += " AND direction_id = ?";
			params.push(directionId);
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM trips ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...params) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			SELECT *
			FROM trips
			${whereClause}
			ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}
			LIMIT ? OFFSET ?
		`;
		params.push(limit, offset);

		const rows = db.prepare(dataQuery).all(...params) as any[];

		return {
			data: rows.map((row) => this.mapTripRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Query stop times with filtering, sorting, and pagination
	 */
	public queryStopTimes(
		dataset: string | undefined,
		options: StopTimeQueryOptions = {},
	): PaginatedResult<GTFSStopTime> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			tripId,
			stopId,
			limit = 100,
			offset = 0,
			sortBy = "stop_sequence",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		if (tripId) {
			whereClause += " AND trip_id = ?";
			params.push(tripId);
		}

		if (stopId) {
			whereClause += " AND stop_id = ?";
			params.push(stopId);
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM stop_times ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...params) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			SELECT *
			FROM stop_times
			${whereClause}
			ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}
			LIMIT ? OFFSET ?
		`;
		params.push(limit, offset);

		const rows = db.prepare(dataQuery).all(...params) as any[];

		return {
			data: rows.map((row) => this.mapStopTimeRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Query calendar with filtering, sorting, and pagination
	 */
	public queryCalendar(
		dataset: string | undefined,
		options: CalendarQueryOptions = {},
	): PaginatedResult<GTFSCalendar> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			serviceId,
			limit = 100,
			offset = 0,
			sortBy = "service_id",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		if (serviceId) {
			whereClause += " AND service_id = ?";
			params.push(serviceId);
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM calendar ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...params) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			SELECT *
			FROM calendar
			${whereClause}
			ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}
			LIMIT ? OFFSET ?
		`;
		params.push(limit, offset);

		const rows = db.prepare(dataQuery).all(...params) as any[];

		return {
			data: rows.map((row) => this.mapCalendarRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Query calendar dates with filtering, sorting, and pagination
	 */
	public queryCalendarDates(
		dataset: string | undefined,
		options: CalendarDateQueryOptions = {},
	): PaginatedResult<GTFSCalendarDate> {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			serviceId,
			date,
			exceptionType,
			limit = 100,
			offset = 0,
			sortBy = "date",
			sortOrder = "asc",
		} = options;

		let whereClause = "WHERE 1=1";
		const params: any[] = [];

		if (serviceId) {
			whereClause += " AND service_id = ?";
			params.push(serviceId);
		}

		if (date) {
			whereClause += " AND date = ?";
			params.push(date);
		}

		if (exceptionType !== undefined) {
			whereClause += " AND exception_type = ?";
			params.push(exceptionType);
		}

		// Count query
		const countQuery = `SELECT COUNT(*) as count FROM calendar_dates ${whereClause}`;
		const countResult = db.prepare(countQuery).get(...params) as {
			count: number;
		};
		const total = countResult.count;

		// Data query
		const dataQuery = `
			SELECT *
			FROM calendar_dates
			${whereClause}
			ORDER BY ${this.sanitizeColumn(sortBy)} ${sortOrder === "desc" ? "DESC" : "ASC"}
			LIMIT ? OFFSET ?
		`;
		params.push(limit, offset);

		const rows = db.prepare(dataQuery).all(...params) as any[];

		return {
			data: rows.map((row) => this.mapCalendarDateRow(row, resolvedDataset)),
			total,
			limit,
			offset,
		};
	}

	/**
	 * Get a single stop by ID
	 */
	public getStop(dataset: string | undefined, stopId: string): GTFSStop | null {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const row = db
			.prepare("SELECT * FROM stops WHERE stop_id = ?")
			.get(stopId) as any;
		return row ? this.mapStopRow(row, resolvedDataset) : null;
	}

	/**
	 * Get a single route by ID
	 */
	public getRoute(
		dataset: string | undefined,
		routeId: string,
	): GTFSRoute | null {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const row = db
			.prepare("SELECT * FROM routes WHERE route_id = ?")
			.get(routeId) as any;
		return row ? this.mapRouteRow(row, resolvedDataset) : null;
	}

	/**
	 * Get a single trip by ID
	 */
	public getTrip(dataset: string | undefined, tripId: string): GTFSTrip | null {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const row = db
			.prepare("SELECT * FROM trips WHERE trip_id = ?")
			.get(tripId) as any;
		return row ? this.mapTripRow(row, resolvedDataset) : null;
	}

	// Row mapping functions
	private mapStopRow(row: any, dataset: string): GTFSStop {
		return {
			stopId: row.stop_id,
			stopCode: row.stop_code,
			stopName: row.stop_name,
			stopDesc: row.stop_desc,
			stopLat: row.stop_lat,
			stopLon: row.stop_lon,
			zoneId: row.zone_id,
			stopUrl: row.stop_url,
			locationType: row.location_type,
			parentStation: row.parent_station,
			stopTimezone: row.stop_timezone,
			wheelchairBoarding: row.wheelchair_boarding,
			dataset,
		};
	}

	private mapRouteRow(row: any, dataset: string): GTFSRoute {
		return {
			routeId: row.route_id,
			agencyId: row.agency_id,
			routeShortName: row.route_short_name,
			routeLongName: row.route_long_name,
			routeDesc: row.route_desc,
			routeType: row.route_type,
			routeUrl: row.route_url,
			routeColor: row.route_color,
			routeTextColor: row.route_text_color,
			routeSortOrder: row.route_sort_order,
			dataset,
		};
	}

	private mapTripRow(row: any, dataset: string): GTFSTrip {
		return {
			tripId: row.trip_id,
			routeId: row.route_id,
			serviceId: row.service_id,
			tripHeadsign: row.trip_headsign,
			tripShortName: row.trip_short_name,
			directionId: row.direction_id,
			blockId: row.block_id,
			shapeId: row.shape_id,
			wheelchairAccessible: row.wheelchair_accessible,
			bikesAllowed: row.bikes_allowed,
			dataset,
		};
	}

	private mapStopTimeRow(row: any, dataset: string): GTFSStopTime {
		return {
			tripId: row.trip_id,
			arrivalTime: row.arrival_time,
			departureTime: row.departure_time,
			stopId: row.stop_id,
			stopSequence: row.stop_sequence,
			stopHeadsign: row.stop_headsign,
			pickupType: row.pickup_type,
			dropOffType: row.drop_off_type,
			shapeDistTraveled: row.shape_dist_traveled,
			timepoint: row.timepoint,
			dataset,
		};
	}

	private mapCalendarRow(row: any, dataset: string): GTFSCalendar {
		return {
			serviceId: row.service_id,
			monday: row.monday,
			tuesday: row.tuesday,
			wednesday: row.wednesday,
			thursday: row.thursday,
			friday: row.friday,
			saturday: row.saturday,
			sunday: row.sunday,
			startDate: row.start_date,
			endDate: row.end_date,
			dataset,
		};
	}

	private mapCalendarDateRow(row: any, dataset: string): GTFSCalendarDate {
		return {
			serviceId: row.service_id,
			date: row.date,
			exceptionType: row.exception_type,
			dataset,
		};
	}

	/**
	 * Sanitize column name to prevent SQL injection
	 */
	private sanitizeColumn(column: string): string {
		// Only allow alphanumeric and underscore
		return column.replace(/[^a-zA-Z0-9_]/g, "");
	}
}

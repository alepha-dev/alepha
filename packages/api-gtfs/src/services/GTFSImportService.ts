import type { DatabaseSync } from "node:sqlite";
import { $inject, AlephaError } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { parse } from "csv-parse/sync";
import JSZip, { file } from "jszip";
import type { GTFSImportResult } from "../schemas/gtfsImportResultSchema.ts";
import { GtfsDatabaseService } from "./GtfsDatabaseService.ts";

/**
 * Service for importing GTFS data from ZIP files
 */
export class GtfsImportService {
	private readonly dbService = $inject(GtfsDatabaseService);
	private readonly log = $logger();

	public async fetch(url: string): Promise<Buffer> {
		if (url.startsWith("data:")) {
			// Base64-encoded data
			const base64Data = url.split(",")[1];
			return Buffer.from(base64Data, "base64");
		}

		// Fetch from URL
		const response = await fetch(url);
		if (!response.ok) {
			throw new AlephaError(
				`Failed to fetch GTFS data: ${response.statusText}`,
			);
		}
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}

	/**
	 * Import GTFS data from a ZIP file buffer
	 */
	public async import(
		dataset: string,
		zipBuffer: Buffer,
		inMemory?: boolean,
	): Promise<GTFSImportResult> {
		this.log.info(
			`Starting GTFS import for dataset: ${dataset} (${inMemory ? "in-memory" : "file-based"})`,
		);

		try {
			// Delete existing dataset if it exists
			if (await this.dbService.hasDataset(dataset, inMemory)) {
				this.log.info(`Deleting existing dataset: ${dataset}`);
				await this.dbService.deleteDataset(dataset, inMemory);
			}

			// Get database for this dataset
			const db = this.dbService.getDatabase(dataset, inMemory);

			this.log.debug(`Extracting ZIP file for dataset: ${dataset}`);
			// Extract ZIP file
			const zip = await JSZip.loadAsync(zipBuffer);

			// Parse required files
			this.log.debug(`Parsing CSV files for dataset: ${dataset}`);
			const stops = await this.parseCSV(zip, "stops.txt");
			const routes = await this.parseCSV(zip, "routes.txt");
			const trips = await this.parseCSV(zip, "trips.txt");
			const stopTimes = await this.parseCSV(zip, "stop_times.txt");
			const calendar = await this.parseCSV(zip, "calendar.txt");
			const calendarDates = await this.parseCSV(zip, "calendar_dates.txt");

			this.log.debug(
				`Parsed ${stops.length} stops, ${routes.length} routes, ${trips.length} trips`,
			);

			// Validate stops
			this.log.debug(`Validating stops for dataset: ${dataset}`);
			this.validateStops(stops);

			// Import data using transactions
			this.log.info(`Importing data for dataset: ${dataset}`);
			const counts = this.importData(db, {
				stops,
				routes,
				trips,
				stopTimes,
				calendar,
				calendarDates,
			});

			this.log.info(
				`Successfully imported GTFS data for dataset: ${dataset}`,
				counts,
			);

			return {
				dataset,
				success: true,
				counts,
			};
		} catch (error) {
			this.log.error(
				`Failed to import GTFS data for dataset: ${dataset}`,
				error,
			);

			// Clean up on error
			if (await this.dbService.hasDataset(dataset, inMemory)) {
				await this.dbService.deleteDataset(dataset, inMemory);
			}

			return {
				dataset,
				success: false,
				counts: {
					stops: 0,
					routes: 0,
					trips: 0,
					stopTimes: 0,
					calendar: 0,
					calendarDates: 0,
				},
				message:
					error instanceof Error
						? error.message
						: "Unknown error during import",
			};
		}
	}

	/**
	 * Parse a CSV file from the ZIP archive
	 */
	private async parseCSV(zip: JSZip, filename: string): Promise<any[]> {
		const file = zip.file(filename);
		if (!file) {
			// Calendar dates is optional
			if (filename === "calendar_dates.txt") {
				return [];
			}
			throw new Error(`Required file ${filename} not found in GTFS archive`);
		}

		const content = await file.async("text");
		return parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
			cast: true,
			cast_date: false,
			relax_column_count: true,
		});
	}

	/**
	 * Validate stops data
	 */
	private validateStops(stops: any[]): void {
		if (stops.length === 0) {
			throw new Error("No stops found in GTFS data");
		}

		for (const stop of stops) {
			// Validate required fields
			if (!stop.stop_id) {
				throw new Error("Stop missing required field: stop_id");
			}
			if (!stop.stop_name) {
				throw new Error(
					`Stop ${stop.stop_id} missing required field: stop_name`,
				);
			}

			// Validate lat/lon
			const lat = Number.parseFloat(stop.stop_lat);
			const lon = Number.parseFloat(stop.stop_lon);

			if (Number.isNaN(lat) || Number.isNaN(lon)) {
				throw new Error(
					`Stop ${stop.stop_id} has invalid or missing latitude/longitude`,
				);
			}

			if (lat < -90 || lat > 90) {
				throw new Error(`Stop ${stop.stop_id} has invalid latitude: ${lat}`);
			}

			if (lon < -180 || lon > 180) {
				throw new Error(`Stop ${stop.stop_id} has invalid longitude: ${lon}`);
			}
		}
	}

	/**
	 * Import all data into the database
	 */
	private importData(
		db: DatabaseSync,
		data: {
			stops: any[];
			routes: any[];
			trips: any[];
			stopTimes: any[];
			calendar: any[];
			calendarDates: any[];
		},
	): GTFSImportResult["counts"] {
		// Use a transaction for better performance
		db.exec("BEGIN TRANSACTION");

		try {
			// Import stops
			const insertStop = db.prepare(`
				INSERT INTO stops (
					stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon,
					zone_id, stop_url, location_type, parent_station, stop_timezone, wheelchair_boarding
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stop of data.stops) {
				insertStop.run(
					stop.stop_id,
					stop.stop_code || null,
					stop.stop_name,
					stop.stop_desc || null,
					Number.parseFloat(stop.stop_lat),
					Number.parseFloat(stop.stop_lon),
					stop.zone_id || null,
					stop.stop_url || null,
					stop.location_type ? Number.parseInt(stop.location_type, 10) : null,
					stop.parent_station || null,
					stop.stop_timezone || null,
					stop.wheelchair_boarding
						? Number.parseInt(stop.wheelchair_boarding, 10)
						: null,
				);
			}

			// Populate stops FTS
			db.exec(
				"INSERT INTO stops_fts(stop_id, stop_name, stop_desc) SELECT stop_id, stop_name, stop_desc FROM stops",
			);

			// Import routes
			const insertRoute = db.prepare(`
				INSERT INTO routes (
					route_id, agency_id, route_short_name, route_long_name, route_desc,
					route_type, route_url, route_color, route_text_color, route_sort_order
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const route of data.routes) {
				insertRoute.run(
					route.route_id,
					route.agency_id || null,
					route.route_short_name || null,
					route.route_long_name || null,
					route.route_desc || null,
					Number.parseInt(route.route_type, 10),
					route.route_url || null,
					route.route_color || null,
					route.route_text_color || null,
					route.route_sort_order
						? Number.parseInt(route.route_sort_order, 10)
						: null,
				);
			}

			// Populate routes FTS
			db.exec(
				"INSERT INTO routes_fts(route_id, route_short_name, route_long_name, route_desc) SELECT route_id, route_short_name, route_long_name, route_desc FROM routes",
			);

			// Import trips
			const insertTrip = db.prepare(`
				INSERT INTO trips (
					trip_id, route_id, service_id, trip_headsign, trip_short_name,
					direction_id, block_id, shape_id, wheelchair_accessible, bikes_allowed
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const trip of data.trips) {
				insertTrip.run(
					trip.trip_id,
					trip.route_id,
					trip.service_id,
					trip.trip_headsign || null,
					trip.trip_short_name || null,
					trip.direction_id ? Number.parseInt(trip.direction_id, 10) : null,
					trip.block_id || null,
					trip.shape_id || null,
					trip.wheelchair_accessible
						? Number.parseInt(trip.wheelchair_accessible, 10)
						: null,
					trip.bikes_allowed ? Number.parseInt(trip.bikes_allowed, 10) : null,
				);
			}

			// Import stop times
			const insertStopTime = db.prepare(`
				INSERT INTO stop_times (
					trip_id, arrival_time, departure_time, stop_id, stop_sequence,
					stop_headsign, pickup_type, drop_off_type, shape_dist_traveled, timepoint
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stopTime of data.stopTimes) {
				insertStopTime.run(
					stopTime.trip_id,
					stopTime.arrival_time,
					stopTime.departure_time,
					stopTime.stop_id,
					Number.parseInt(stopTime.stop_sequence, 10),
					stopTime.stop_headsign || null,
					stopTime.pickup_type
						? Number.parseInt(stopTime.pickup_type, 10)
						: null,
					stopTime.drop_off_type
						? Number.parseInt(stopTime.drop_off_type, 10)
						: null,
					stopTime.shape_dist_traveled
						? Number.parseFloat(stopTime.shape_dist_traveled)
						: null,
					stopTime.timepoint ? Number.parseInt(stopTime.timepoint, 10) : null,
				);
			}

			// Import calendar
			const insertCalendar = db.prepare(`
				INSERT INTO calendar (
					service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
					start_date, end_date
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const cal of data.calendar) {
				insertCalendar.run(
					cal.service_id,
					Number.parseInt(cal.monday, 10),
					Number.parseInt(cal.tuesday, 10),
					Number.parseInt(cal.wednesday, 10),
					Number.parseInt(cal.thursday, 10),
					Number.parseInt(cal.friday, 10),
					Number.parseInt(cal.saturday, 10),
					Number.parseInt(cal.sunday, 10),
					cal.start_date,
					cal.end_date,
				);
			}

			// Import calendar dates
			if (data.calendarDates.length > 0) {
				const insertCalendarDate = db.prepare(`
					INSERT INTO calendar_dates (service_id, date, exception_type)
					VALUES (?, ?, ?)
				`);

				for (const calDate of data.calendarDates) {
					insertCalendarDate.run(
						calDate.service_id,
						calDate.date,
						Number.parseInt(calDate.exception_type, 10),
					);
				}
			}

			db.exec("COMMIT");

			return {
				stops: data.stops.length,
				routes: data.routes.length,
				trips: data.trips.length,
				stopTimes: data.stopTimes.length,
				calendar: data.calendar.length,
				calendarDates: data.calendarDates.length,
			};
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
}

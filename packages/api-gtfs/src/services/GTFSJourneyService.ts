import { $inject } from "@alepha/core";
import { GtfsDatabaseService } from "./GtfsDatabaseService.ts";

export interface JourneyLeg {
	tripId: string;
	routeId: string;
	routeName: string;
	departureStop: string;
	departureStopName: string;
	departureTime: string;
	arrivalStop: string;
	arrivalStopName: string;
	arrivalTime: string;
	headsign?: string;
}

export interface Journey {
	legs: JourneyLeg[];
	totalDuration: number; // in minutes
	departureTime: string;
	arrivalTime: string;
}

export interface JourneyOptions {
	origin: string; // stop name or stop_id
	destination: string; // stop name or stop_id
	departureDate: string; // YYYYMMDD format
	departureTime?: string; // HH:MM format
	maxResults?: number;
}

/**
 * Service for planning journeys using GTFS data
 */
export class GtfsJourneyService {
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
	 * Plan a journey from origin to destination
	 */
	public planJourney(
		dataset: string | undefined,
		options: JourneyOptions,
	): Journey[] {
		const resolvedDataset = this.resolveDataset(dataset);
		const db = this.dbService.getDatabase(resolvedDataset);
		const {
			origin,
			destination,
			departureDate,
			departureTime = "00:00",
			maxResults = 10,
		} = options;

		// Find origin and destination stops
		const originStops = this.findStops(resolvedDataset, origin);
		const destinationStops = this.findStops(resolvedDataset, destination);

		if (originStops.length === 0) {
			throw new Error(`Origin stop not found: ${origin}`);
		}

		if (destinationStops.length === 0) {
			throw new Error(`Destination stop not found: ${destination}`);
		}

		// Get service IDs active on the departure date
		const serviceIds = this.getActiveServices(resolvedDataset, departureDate);

		if (serviceIds.length === 0) {
			return [];
		}

		const journeys: Journey[] = [];

		// Find direct trips (no transfers)
		for (const originStop of originStops) {
			for (const destinationStop of destinationStops) {
				const directTrips = this.findDirectTrips(
					db,
					originStop.stop_id,
					destinationStop.stop_id,
					serviceIds,
					departureTime,
				);

				for (const trip of directTrips) {
					journeys.push({
						legs: [
							{
								tripId: trip.trip_id,
								routeId: trip.route_id,
								routeName: trip.route_name,
								departureStop: originStop.stop_id,
								departureStopName: originStop.stop_name,
								departureTime: trip.departure_time,
								arrivalStop: destinationStop.stop_id,
								arrivalStopName: destinationStop.stop_name,
								arrivalTime: trip.arrival_time,
								headsign: trip.trip_headsign,
							},
						],
						totalDuration: this.calculateDuration(
							trip.departure_time,
							trip.arrival_time,
						),
						departureTime: trip.departure_time,
						arrivalTime: trip.arrival_time,
					});
				}
			}
		}

		// Sort by departure time
		journeys.sort((a, b) => {
			return (
				this.timeToMinutes(a.departureTime) -
				this.timeToMinutes(b.departureTime)
			);
		});

		return journeys.slice(0, maxResults);
	}

	/**
	 * Find stops by name or ID
	 */
	private findStops(dataset: string, query: string): any[] {
		const db = this.dbService.getDatabase(dataset);

		// First try exact match by ID
		const byId = db.prepare("SELECT * FROM stops WHERE stop_id = ?").all(query);
		if (byId.length > 0) {
			return byId;
		}

		// Then try full-text search
		const byName = db
			.prepare(`
			SELECT s.*
			FROM stops s
			JOIN stops_fts ON s.stop_id = stops_fts.stop_id
			WHERE stops_fts MATCH ?
			LIMIT 10
		`)
			.all(query);

		return byName;
	}

	/**
	 * Get active service IDs for a given date
	 */
	private getActiveServices(dataset: string, date: string): string[] {
		const db = this.dbService.getDatabase(dataset);
		const dayOfWeek = this.getDayOfWeek(date);
		const serviceIds: string[] = [];

		// Get services from calendar
		const calendarServices = db
			.prepare(`
			SELECT service_id
			FROM calendar
			WHERE ${dayOfWeek} = 1
			AND start_date <= ?
			AND end_date >= ?
		`)
			.all(date, date) as any[];

		for (const service of calendarServices) {
			serviceIds.push(service.service_id);
		}

		// Apply calendar_dates exceptions
		const exceptions = db
			.prepare(`
			SELECT service_id, exception_type
			FROM calendar_dates
			WHERE date = ?
		`)
			.all(date) as any[];

		for (const exception of exceptions) {
			if (exception.exception_type === 1) {
				// Service added
				if (!serviceIds.includes(exception.service_id)) {
					serviceIds.push(exception.service_id);
				}
			} else if (exception.exception_type === 2) {
				// Service removed
				const index = serviceIds.indexOf(exception.service_id);
				if (index > -1) {
					serviceIds.splice(index, 1);
				}
			}
		}

		return serviceIds;
	}

	/**
	 * Find direct trips between two stops
	 */
	private findDirectTrips(
		db: any,
		originStopId: string,
		destinationStopId: string,
		serviceIds: string[],
		departureTime: string,
	): any[] {
		const serviceIdsList = serviceIds.map(() => "?").join(",");

		const query = `
			SELECT DISTINCT
				t.trip_id,
				t.route_id,
				t.trip_headsign,
				COALESCE(r.route_short_name, r.route_long_name) as route_name,
				st1.departure_time,
				st2.arrival_time,
				st1.stop_sequence as origin_sequence,
				st2.stop_sequence as destination_sequence
			FROM trips t
			JOIN routes r ON t.route_id = r.route_id
			JOIN stop_times st1 ON t.trip_id = st1.trip_id
			JOIN stop_times st2 ON t.trip_id = st2.trip_id
			WHERE t.service_id IN (${serviceIdsList})
			AND st1.stop_id = ?
			AND st2.stop_id = ?
			AND st1.stop_sequence < st2.stop_sequence
			AND st1.departure_time >= ?
			ORDER BY st1.departure_time
			LIMIT 50
		`;

		return db
			.prepare(query)
			.all(...serviceIds, originStopId, destinationStopId, departureTime);
	}

	/**
	 * Get day of week from YYYYMMDD date
	 */
	private getDayOfWeek(dateStr: string): string {
		const year = Number.parseInt(dateStr.substring(0, 4), 10);
		const month = Number.parseInt(dateStr.substring(4, 6), 10) - 1; // JS months are 0-indexed
		const day = Number.parseInt(dateStr.substring(6, 8), 10);
		const date = new Date(year, month, day);
		const days = [
			"sunday",
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
			"saturday",
		];
		return days[date.getDay()];
	}

	/**
	 * Calculate duration between two times in minutes
	 */
	private calculateDuration(startTime: string, endTime: string): number {
		return this.timeToMinutes(endTime) - this.timeToMinutes(startTime);
	}

	/**
	 * Convert HH:MM:SS time to minutes since midnight
	 */
	private timeToMinutes(time: string): number {
		const parts = time.split(":");
		const hours = Number.parseInt(parts[0], 10);
		const minutes = Number.parseInt(parts[1], 10);
		return hours * 60 + minutes;
	}
}

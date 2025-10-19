import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { $inject, Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";

/**
 * Service for managing GTFS SQLite databases
 */
export class GtfsDatabaseService {
	private databases: Map<string, DatabaseSync> = new Map();
	private readonly dbPath: string;
	private readonly alepha = $inject(Alepha);
	private readonly log = $logger();

	constructor() {
		// Store databases in node_modules/.gtfs/
		this.dbPath = path.join(process.cwd(), "node_modules", ".gtfs");
	}

	/**
	 * Get the default dataset (first one loaded)
	 */
	public getDefaultDataset(): string | null {
		if (this.databases.size === 0) {
			return null;
		}

		// Get the first dataset key and remove the ":memory" suffix if present
		const firstKey = Array.from(this.databases.keys())[0];
		return firstKey.endsWith(":memory")
			? firstKey.substring(0, firstKey.length - 7)
			: firstKey;
	}

	/**
	 * Get or create a database for a specific dataset
	 * @param dataset - Name of the dataset
	 * @param inMemory - Use in-memory database (defaults to true in test environment)
	 */
	public getDatabase(dataset: string, inMemory?: boolean): DatabaseSync {
		// Default to in-memory in test environment
		const useMemory = inMemory ?? this.alepha.isTest();
		const key = useMemory ? `${dataset}:memory` : dataset;

		if (this.databases.has(key)) {
			this.log.debug(
				`Reusing existing database for dataset: ${dataset} (${useMemory ? "in-memory" : "file-based"})`,
			);
			return this.databases.get(key)!;
		}

		this.log.info(
			`Creating new database for dataset: ${dataset} (${useMemory ? "in-memory" : "file-based"})`,
		);

		let db: DatabaseSync;
		if (useMemory) {
			// Create in-memory database
			db = new DatabaseSync(":memory:");
		} else {
			// Create file-based database
			const dbFile = path.join(this.dbPath, `${dataset}.db`);
			db = new DatabaseSync(dbFile);
		}

		// Enable foreign keys
		db.exec("PRAGMA foreign_keys = ON");

		// Create tables
		this.createTables(db);

		this.databases.set(key, db);
		this.log.info(`Database created successfully for dataset: ${dataset}`);
		return db;
	}

	/**
	 * Check if a dataset exists
	 */
	public async hasDataset(
		dataset: string,
		inMemory?: boolean,
	): Promise<boolean> {
		const useMemory = inMemory ?? this.alepha.isTest();

		// Check in-memory databases
		if (useMemory && this.databases.has(`${dataset}:memory`)) {
			return true;
		}

		// Check regular databases
		if (this.databases.has(dataset)) {
			return true;
		}

		// Check file system for file-based databases
		if (!useMemory) {
			const dbFile = path.join(this.dbPath, `${dataset}.db`);
			try {
				await fs.access(dbFile);
				return true;
			} catch {
				return false;
			}
		}

		return false;
	}

	/**
	 * List all available datasets with their storage type
	 */
	public async listDatasets(
		inMemory?: boolean,
	): Promise<Array<{ name: string; url: string }>> {
		const useMemory = inMemory ?? this.alepha.isTest();
		const datasetsMap = new Map<string, string>();

		// Add in-memory databases
		for (const key of this.databases.keys()) {
			if (key.endsWith(":memory")) {
				const dataset = key.replace(":memory", "");
				datasetsMap.set(dataset, ":memory:");
			} else {
				const dbFile = path.join(this.dbPath, `${key}.db`);
				datasetsMap.set(key, dbFile);
			}
		}

		// Add file-based databases
		if (!useMemory) {
			try {
				await fs.access(this.dbPath);
				const files = await fs.readdir(this.dbPath);
				const dbFiles = files.filter((file) => file.endsWith(".db"));

				for (const file of dbFiles) {
					const dataset = file.replace(".db", "");
					if (!datasetsMap.has(dataset)) {
						const dbFile = path.join(this.dbPath, file);
						datasetsMap.set(dataset, dbFile);
					}
				}
			} catch {
				// Directory doesn't exist, ignore
			}
		}

		return Array.from(datasetsMap.entries()).map(([name, url]) => ({
			name,
			url,
		}));
	}

	/**
	 * Delete a dataset
	 */
	public async deleteDataset(
		dataset: string,
		inMemory?: boolean,
	): Promise<void> {
		const useMemory = inMemory ?? this.alepha.isTest();

		// Close and delete in-memory database if exists
		const memoryKey = `${dataset}:memory`;
		if (this.databases.has(memoryKey)) {
			this.databases.get(memoryKey)!.close();
			this.databases.delete(memoryKey);
		}

		// Close and delete regular database if exists
		if (this.databases.has(dataset)) {
			this.databases.get(dataset)!.close();
			this.databases.delete(dataset);
		}

		// Delete database file if exists
		if (!useMemory) {
			const dbFile = path.join(this.dbPath, `${dataset}.db`);
			try {
				await fs.unlink(dbFile);
			} catch {
				// File doesn't exist, ignore
			}
		}
	}

	/**
	 * Create all GTFS tables
	 */
	private createTables(db: DatabaseSync): void {
		// Stops table
		db.exec(`
			CREATE TABLE IF NOT EXISTS stops (
				stop_id TEXT PRIMARY KEY,
				stop_code TEXT,
				stop_name TEXT NOT NULL,
				stop_desc TEXT,
				stop_lat REAL NOT NULL,
				stop_lon REAL NOT NULL,
				zone_id TEXT,
				stop_url TEXT,
				location_type INTEGER,
				parent_station TEXT,
				stop_timezone TEXT,
				wheelchair_boarding INTEGER
			)
		`);

		// Create index for location-based queries
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_stops_location
			ON stops(stop_lat, stop_lon)
		`);

		// Create FTS5 virtual table for stop search
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS stops_fts USING fts5(
				stop_id UNINDEXED,
				stop_name,
				stop_desc,
				content=stops,
				content_rowid=rowid
			)
		`);

		// Routes table
		db.exec(`
			CREATE TABLE IF NOT EXISTS routes (
				route_id TEXT PRIMARY KEY,
				agency_id TEXT,
				route_short_name TEXT,
				route_long_name TEXT,
				route_desc TEXT,
				route_type INTEGER NOT NULL,
				route_url TEXT,
				route_color TEXT,
				route_text_color TEXT,
				route_sort_order INTEGER
			)
		`);

		// Create FTS5 virtual table for route search
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS routes_fts USING fts5(
				route_id UNINDEXED,
				route_short_name,
				route_long_name,
				route_desc,
				content=routes,
				content_rowid=rowid
			)
		`);

		// Trips table
		db.exec(`
			CREATE TABLE IF NOT EXISTS trips (
				trip_id TEXT PRIMARY KEY,
				route_id TEXT NOT NULL,
				service_id TEXT NOT NULL,
				trip_headsign TEXT,
				trip_short_name TEXT,
				direction_id INTEGER,
				block_id TEXT,
				shape_id TEXT,
				wheelchair_accessible INTEGER,
				bikes_allowed INTEGER,
				FOREIGN KEY (route_id) REFERENCES routes(route_id)
			)
		`);

		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_trips_route
			ON trips(route_id)
		`);

		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_trips_service
			ON trips(service_id)
		`);

		// Stop times table
		db.exec(`
			CREATE TABLE IF NOT EXISTS stop_times (
				trip_id TEXT NOT NULL,
				arrival_time TEXT NOT NULL,
				departure_time TEXT NOT NULL,
				stop_id TEXT NOT NULL,
				stop_sequence INTEGER NOT NULL,
				stop_headsign TEXT,
				pickup_type INTEGER,
				drop_off_type INTEGER,
				shape_dist_traveled REAL,
				timepoint INTEGER,
				PRIMARY KEY (trip_id, stop_sequence),
				FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
				FOREIGN KEY (stop_id) REFERENCES stops(stop_id)
			)
		`);

		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_stop_times_stop
			ON stop_times(stop_id)
		`);

		// Calendar table
		db.exec(`
			CREATE TABLE IF NOT EXISTS calendar (
				service_id TEXT PRIMARY KEY,
				monday INTEGER NOT NULL,
				tuesday INTEGER NOT NULL,
				wednesday INTEGER NOT NULL,
				thursday INTEGER NOT NULL,
				friday INTEGER NOT NULL,
				saturday INTEGER NOT NULL,
				sunday INTEGER NOT NULL,
				start_date TEXT NOT NULL,
				end_date TEXT NOT NULL
			)
		`);

		// Calendar dates table
		db.exec(`
			CREATE TABLE IF NOT EXISTS calendar_dates (
				service_id TEXT NOT NULL,
				date TEXT NOT NULL,
				exception_type INTEGER NOT NULL,
				PRIMARY KEY (service_id, date)
			)
		`);

		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_calendar_dates_date
			ON calendar_dates(date)
		`);
	}

	/**
	 * Close all database connections
	 */
	public close(): void {
		for (const db of this.databases.values()) {
			db.close();
		}
		this.databases.clear();
	}
}

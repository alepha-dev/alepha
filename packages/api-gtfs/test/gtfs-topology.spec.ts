import * as fs from "node:fs";
import * as path from "node:path";
import { Alepha } from "@alepha/core";
import { describe, it } from "vitest";
import {
	AlephaApiGtfs,
	GtfsDatasetController,
	GtfsTopologyController,
} from "../src";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiGtfs);
	const datasetController = alepha.inject(GtfsDatasetController);
	const topologyController = alepha.inject(GtfsTopologyController);

	await alepha.start();

	return {
		alepha,
		datasetController,
		topologyController,
	};
};

const loadSampleFeed = (): Buffer => {
	const samplePath = path.join(__dirname, "../assets/sample-feed.zip");
	return fs.readFileSync(samplePath);
};

describe("GTFS Stops Query", () => {
	it("should query all stops", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stops",
				url: base64Data,
			},
		});

		const result = await topologyController.queryStops({
			query: { dataset: "test-stops" },
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.total).toBeGreaterThan(0);
		expect(result.data[0]).toHaveProperty("stopId");
		expect(result.data[0]).toHaveProperty("stopName");
		expect(result.data[0]).toHaveProperty("stopLat");
		expect(result.data[0]).toHaveProperty("stopLon");
	});

	it("should query stops with pagination", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stops-pagination",
				url: base64Data,
			},
		});

		const page1 = await topologyController.queryStops({
			query: { dataset: "test-stops-pagination", limit: 5, offset: 0 },
		});

		const page2 = await topologyController.queryStops({
			query: { dataset: "test-stops-pagination", limit: 5, offset: 5 },
		});

		expect(page1.data.length).toBeLessThanOrEqual(5);
		expect(page2.data.length).toBeLessThanOrEqual(5);
		expect(page1.data[0].stopId).not.toBe(page2.data[0]?.stopId);
	});

	it("should search stops with full-text search", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stops-search",
				url: base64Data,
			},
		});

		// First get all stops to see what's available
		const allStops = await topologyController.queryStops({
			query: { dataset: "test-stops-search" },
		});

		expect(allStops.data.length).toBeGreaterThan(0);

		// Search for the first stop's name
		if (allStops.data.length > 0) {
			const firstStopName = allStops.data[0].stopName;
			const searchResult = await topologyController.queryStops({
				query: { dataset: "test-stops-search", search: firstStopName },
			});

			expect(searchResult.data.length).toBeGreaterThan(0);
		}
	});

	it("should get a single stop by ID", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stop-single",
				url: base64Data,
			},
		});

		const stops = await topologyController.queryStops({
			query: { dataset: "test-stop-single", limit: 1 },
		});

		expect(stops.data.length).toBeGreaterThan(0);

		const stopId = stops.data[0].stopId;
		const stop = await topologyController.getStop({
			params: { stopId },
			query: { dataset: "test-stop-single" },
		});

		expect(stop).toBeTruthy();
		expect(stop?.stopId).toBe(stopId);
	});

	it("should use default dataset when not specified", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "default-test",
				url: base64Data,
			},
		});

		const result = await topologyController.queryStops({
			query: {},
		});

		expect(result.data.length).toBeGreaterThan(0);
	});
});

describe("GTFS Routes Query", () => {
	it("should query all routes", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-routes",
				url: base64Data,
			},
		});

		const result = await topologyController.queryRoutes({
			query: { dataset: "test-routes" },
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.total).toBeGreaterThan(0);
		expect(result.data[0]).toHaveProperty("routeId");
		expect(result.data[0]).toHaveProperty("routeType");
	});

	it("should filter routes by type", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-routes-filter",
				url: base64Data,
			},
		});

		// Get all routes first
		const allRoutes = await topologyController.queryRoutes({
			query: { dataset: "test-routes-filter" },
		});

		expect(allRoutes.data.length).toBeGreaterThan(0);

		// Filter by route type
		const routeType = allRoutes.data[0].routeType;
		const filteredRoutes = await topologyController.queryRoutes({
			query: { dataset: "test-routes-filter", routeType },
		});

		expect(filteredRoutes.data.length).toBeGreaterThan(0);
		expect(filteredRoutes.data.every((r) => r.routeType === routeType)).toBe(
			true,
		);
	});

	it("should get a single route by ID", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-route-single",
				url: base64Data,
			},
		});

		const routes = await topologyController.queryRoutes({
			query: { dataset: "test-route-single", limit: 1 },
		});

		expect(routes.data.length).toBeGreaterThan(0);

		const routeId = routes.data[0].routeId;
		const route = await topologyController.getRoute({
			params: { routeId },
			query: { dataset: "test-route-single" },
		});

		expect(route).toBeTruthy();
		expect(route?.routeId).toBe(routeId);
	});
});

describe("GTFS Trips Query", () => {
	it("should query all trips", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-trips",
				url: base64Data,
			},
		});

		const result = await topologyController.queryTrips({
			query: { dataset: "test-trips" },
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.total).toBeGreaterThan(0);
		expect(result.data[0]).toHaveProperty("tripId");
		expect(result.data[0]).toHaveProperty("routeId");
		expect(result.data[0]).toHaveProperty("serviceId");
	});

	it("should filter trips by route", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-trips-filter",
				url: base64Data,
			},
		});

		// Get all trips first
		const allTrips = await topologyController.queryTrips({
			query: { dataset: "test-trips-filter" },
		});

		expect(allTrips.data.length).toBeGreaterThan(0);

		// Filter by route
		const routeId = allTrips.data[0].routeId;
		const filteredTrips = await topologyController.queryTrips({
			query: { dataset: "test-trips-filter", routeId },
		});

		expect(filteredTrips.data.length).toBeGreaterThan(0);
		expect(filteredTrips.data.every((t) => t.routeId === routeId)).toBe(true);
	});
});

describe("GTFS Stop Times Query", () => {
	it("should query stop times for a trip", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stop-times",
				url: base64Data,
			},
		});

		// Get a trip first
		const trips = await topologyController.queryTrips({
			query: { dataset: "test-stop-times", limit: 1 },
		});

		expect(trips.data.length).toBeGreaterThan(0);

		const tripId = trips.data[0].tripId;
		const stopTimes = await topologyController.queryStopTimes({
			query: { dataset: "test-stop-times", tripId },
		});

		expect(stopTimes.data.length).toBeGreaterThan(0);
		expect(stopTimes.data[0]).toHaveProperty("tripId");
		expect(stopTimes.data[0]).toHaveProperty("stopId");
		expect(stopTimes.data[0]).toHaveProperty("arrivalTime");
		expect(stopTimes.data[0]).toHaveProperty("departureTime");
		expect(stopTimes.data.every((st) => st.tripId === tripId)).toBe(true);
	});

	it("should query stop times for a stop", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-stop-times-by-stop",
				url: base64Data,
			},
		});

		// Get a stop first
		const stops = await topologyController.queryStops({
			query: { dataset: "test-stop-times-by-stop", limit: 1 },
		});

		expect(stops.data.length).toBeGreaterThan(0);

		const stopId = stops.data[0].stopId;
		const stopTimes = await topologyController.queryStopTimes({
			query: { dataset: "test-stop-times-by-stop", stopId },
		});

		expect(stopTimes.data.length).toBeGreaterThan(0);
		expect(stopTimes.data.every((st) => st.stopId === stopId)).toBe(true);
	});
});

describe("GTFS Calendar Query", () => {
	it("should query calendar entries", async ({ expect }) => {
		const { datasetController, topologyController } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-calendar",
				url: base64Data,
			},
		});

		const result = await topologyController.queryCalendar({
			query: { dataset: "test-calendar" },
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.data[0]).toHaveProperty("serviceId");
		expect(result.data[0]).toHaveProperty("monday");
		expect(result.data[0]).toHaveProperty("startDate");
		expect(result.data[0]).toHaveProperty("endDate");
	});
});

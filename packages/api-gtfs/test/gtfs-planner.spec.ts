import { Alepha } from "@alepha/core";
import { describe, it } from "vitest";
import {
	AlephaApiGtfs,
	GtfsDatasetController,
	GtfsPlannerController,
	GtfsTopologyController,
} from "../src";
import { createTestGtfs } from "./helpers/createTestGtfs.ts";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiGtfs);
	const datasetController = alepha.inject(GtfsDatasetController);
	const topologyController = alepha.inject(GtfsTopologyController);
	const plannerController = alepha.inject(GtfsPlannerController);

	await alepha.start();

	return {
		alepha,
		datasetController,
		topologyController,
		plannerController,
	};
};

describe("GTFS Journey Planner", () => {
	it("should plan a direct journey between downtown and airport", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-journey",
				url: base64Data,
			},
		});

		// Plan journey from Downtown to Airport on a Monday (20240101 is a Monday)
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-journey",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "08:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		const journey = result.journeys[0];
		expect(journey.legs.length).toBe(1); // Direct trip
		expect(journey.legs[0].departureStop).toBe("stop_downtown");
		expect(journey.legs[0].arrivalStop).toBe("stop_airport");
		expect(journey.legs[0].departureTime >= "08:00:00").toBe(true);
		expect(journey.totalDuration).toBeGreaterThan(0);
	});

	it("should find both regular and express route options", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-multiple",
				url: base64Data,
			},
		});

		// Should find both regular and express routes
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-multiple",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "08:00",
				maxResults: 10,
			},
		});

		expect(result.journeys.length).toBeGreaterThan(1);

		// Journeys should be sorted by departure time
		for (let i = 1; i < result.journeys.length; i++) {
			expect(
				result.journeys[i].departureTime >=
					result.journeys[i - 1].departureTime,
			).toBe(true);
		}

		// Should have different routes (regular and express)
		const routeIds = new Set(result.journeys.map((j) => j.legs[0].routeId));
		expect(routeIds.size).toBeGreaterThan(1);
	});

	it("should plan journey to intermediate stop (university)", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-intermediate",
				url: base64Data,
			},
		});

		// Journey from Downtown to University Campus
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-intermediate",
				origin: "stop_downtown",
				destination: "stop_university",
				departureDate: "20240101",
				departureTime: "09:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		const journey = result.journeys[0];
		expect(journey.legs[0].departureStop).toBe("stop_downtown");
		expect(journey.legs[0].arrivalStop).toBe("stop_university");
		expect(journey.totalDuration).toBeLessThan(20); // Should be around 10 minutes
	});

	it("should find journey using stop names instead of IDs", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-names",
				url: base64Data,
			},
		});

		// Use stop names instead of IDs
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-names",
				origin: "Downtown",
				destination: "Airport",
				departureDate: "20240101",
				departureTime: "10:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		const journey = result.journeys[0];
		expect(journey.legs[0].departureStopName).toContain("Downtown");
		expect(journey.legs[0].arrivalStopName).toContain("Airport");
	});

	it("should respect departure time constraint", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-time",
				url: base64Data,
			},
		});

		// Request journey departing at 15:00
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-time",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "15:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		// All journeys should depart at or after 15:00
		for (const journey of result.journeys) {
			expect(journey.departureTime >= "15:00:00").toBe(true);
		}
	});

	it("should plan journey from library to mall", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-library-mall",
				url: base64Data,
			},
		});

		const result = await plannerController.planJourney({
			body: {
				dataset: "test-library-mall",
				origin: "stop_library",
				destination: "stop_mall",
				departureDate: "20240101",
				departureTime: "12:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		const journey = result.journeys[0];
		expect(journey.legs[0].departureStop).toBe("stop_library");
		expect(journey.legs[0].arrivalStop).toBe("stop_mall");
		expect(journey.totalDuration).toBe(10); // 2 stops * 5 minutes
	});

	it("should use default dataset when not specified", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-default",
				url: base64Data,
			},
		});

		// Don't specify dataset
		const result = await plannerController.planJourney({
			body: {
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "12:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);
	});

	it("should return empty journeys for weekend service", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-weekend",
				url: base64Data,
			},
		});

		// 20240106 is a Saturday - no service
		const result = await plannerController.planJourney({
			body: {
				dataset: "test-weekend",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240106",
				departureTime: "10:00",
			},
		});

		expect(result.journeys.length).toBe(0);
	});

	it("should include complete route and trip information", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-info",
				url: base64Data,
			},
		});

		const result = await plannerController.planJourney({
			body: {
				dataset: "test-info",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "08:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);

		const leg = result.journeys[0].legs[0];
		expect(leg.tripId).toBeTruthy();
		expect(leg.routeId).toBeTruthy();
		expect(leg.routeName).toBeTruthy();
		expect(leg.headsign).toContain("Airport");
		expect(leg.departureStop).toBe("stop_downtown");
		expect(leg.departureStopName).toContain("Downtown");
		expect(leg.arrivalStop).toBe("stop_airport");
		expect(leg.arrivalStopName).toContain("Airport");
		expect(leg.departureTime).toBeTruthy();
		expect(leg.arrivalTime).toBeTruthy();
	});

	it("should throw error for non-existent origin stop", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-error",
				url: base64Data,
			},
		});

		await expect(
			plannerController.planJourney({
				body: {
					dataset: "test-error",
					origin: "nonexistent_stop",
					destination: "stop_airport",
					departureDate: "20240101",
					departureTime: "08:00",
				},
			}),
		).rejects.toThrowError("Origin stop not found");
	});

	it("should throw error for non-existent destination stop", async ({
		expect,
	}) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-error-2",
				url: base64Data,
			},
		});

		await expect(
			plannerController.planJourney({
				body: {
					dataset: "test-error-2",
					origin: "stop_downtown",
					destination: "nonexistent_stop",
					departureDate: "20240101",
					departureTime: "08:00",
				},
			}),
		).rejects.toThrowError("Destination stop not found");
	});

	it("should find early morning journeys", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-morning",
				url: base64Data,
			},
		});

		const result = await plannerController.planJourney({
			body: {
				dataset: "test-morning",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "06:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);
		expect(result.journeys[0].departureTime).toBe("06:00:00");
	});

	it("should find late evening journeys", async ({ expect }) => {
		const { datasetController, plannerController } = await createTest();
		const zipBuffer = await createTestGtfs();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-evening",
				url: base64Data,
			},
		});

		const result = await plannerController.planJourney({
			body: {
				dataset: "test-evening",
				origin: "stop_downtown",
				destination: "stop_airport",
				departureDate: "20240101",
				departureTime: "21:00",
			},
		});

		expect(result.journeys.length).toBeGreaterThan(0);
		// Should find journeys departing at 21:00, 21:30, and 22:00
	});
});

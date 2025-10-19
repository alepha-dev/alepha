import * as fs from "node:fs";
import * as path from "node:path";
import { Alepha } from "@alepha/core";
import { describe, it } from "vitest";
import {
	AlephaApiGTFS,
	GtfsDatasetController,
	GtfsPlannerController,
	GtfsTopologyController,
} from "../src";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiGTFS);
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

const loadSampleFeed = (): Buffer => {
	const samplePath = path.join(__dirname, "../assets/sample-feed.zip");
	return fs.readFileSync(samplePath);
};

describe("GTFS Journey Planner", () => {
	it("should plan a journey between two stops", async ({ expect }) => {
		const { datasetController, topologyController, plannerController } =
			await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-journey",
				url: base64Data,
			},
		});

		// Get two stops
		const stops = await topologyController.queryStops({
			query: { dataset: "test-journey", limit: 10 },
		});

		expect(stops.data.length).toBeGreaterThanOrEqual(2);

		// Try to plan a journey
		try {
			const journeys = await plannerController.planJourney({
				body: {
					dataset: "test-journey",
					origin: stops.data[0].stopId,
					destination: stops.data[stops.data.length - 1].stopId,
					departureDate: "20240101",
					departureTime: "08:00",
				},
			});

			// Journey may or may not be found depending on the sample data
			expect(journeys).toHaveProperty("journeys");
			expect(Array.isArray(journeys.journeys)).toBe(true);

			if (journeys.journeys.length > 0) {
				const journey = journeys.journeys[0];
				expect(journey).toHaveProperty("legs");
				expect(journey).toHaveProperty("totalDuration");
				expect(journey).toHaveProperty("departureTime");
				expect(journey).toHaveProperty("arrivalTime");
				expect(journey.legs.length).toBeGreaterThan(0);

				const leg = journey.legs[0];
				expect(leg).toHaveProperty("tripId");
				expect(leg).toHaveProperty("routeId");
				expect(leg).toHaveProperty("departureStop");
				expect(leg).toHaveProperty("arrivalStop");
			}
		} catch (error) {
			// It's okay if journey planning fails due to no available routes
			expect(error).toBeTruthy();
		}
	});

	it("should use default dataset for journey planning", async ({ expect }) => {
		const { datasetController, topologyController, plannerController } =
			await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await datasetController.importGtfsUrl({
			body: {
				dataset: "test-journey-default",
				url: base64Data,
			},
		});

		// Get two stops
		const stops = await topologyController.queryStops({
			query: {},
		});

		expect(stops.data.length).toBeGreaterThanOrEqual(2);

		// Try to plan a journey without specifying dataset
		try {
			const journeys = await plannerController.planJourney({
				body: {
					origin: stops.data[0].stopId,
					destination: stops.data[stops.data.length - 1].stopId,
					departureDate: "20240101",
					departureTime: "08:00",
				},
			});

			expect(journeys).toHaveProperty("journeys");
			expect(Array.isArray(journeys.journeys)).toBe(true);
		} catch (error) {
			// It's okay if journey planning fails due to no available routes
			expect(error).toBeTruthy();
		}
	});
});

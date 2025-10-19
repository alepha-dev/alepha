import * as fs from "node:fs";
import * as path from "node:path";
import { Alepha } from "@alepha/core";
import { createFile } from "@alepha/file";
import JSZip from "jszip";
import { describe, it } from "vitest";
import { AlephaApiGtfs, GtfsDatasetController } from "../src";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiGtfs);
	const controller = alepha.inject(GtfsDatasetController);

	await alepha.start();

	return {
		alepha,
		controller,
	};
};

const loadSampleFeed = (): Buffer => {
	const samplePath = path.join(__dirname, "../assets/sample-feed.zip");
	return fs.readFileSync(samplePath);
};

describe("GTFS Dataset Management", () => {
	it("should import GTFS data from ZIP file", async ({ expect }) => {
		const { controller } = await createTest();
		const zipBuffer = loadSampleFeed();

		const result = await controller.importGtfsFile({
			body: {
				file: createFile(zipBuffer, {
					name: "test-agency.zip",
				}),
			},
		});

		expect(result.success).toBe(true);
		expect(result.dataset).toBe("test-agency");
		expect(result.counts.stops).toBeGreaterThan(0);
		expect(result.counts.routes).toBeGreaterThan(0);
		expect(result.counts.trips).toBeGreaterThan(0);
		expect(result.counts.stopTimes).toBeGreaterThan(0);
	});

	it("should import GTFS data in memory", async ({ expect }) => {
		const { controller } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		const result = await controller.importGtfsUrl({
			body: {
				dataset: "test-memory",
				url: base64Data,
				inMemory: true,
			},
		});

		expect(result.success).toBe(true);
		expect(result.dataset).toBe("test-memory");

		const datasets = await controller.listDatasets();
		const memoryDataset = datasets.datasets.find(
			(d) => d.name === "test-memory",
		);
		expect(memoryDataset?.url).toBe(":memory:");
	});

	it("should reject import with invalid stops", async ({ expect }) => {
		const { controller } = await createTest();

		// Create a minimal GTFS with invalid stops (missing lat/lon)
		const zip = new JSZip();

		zip.file(
			"stops.txt",
			"stop_id,stop_name,stop_lat,stop_lon\n" + "stop1,Test Stop,,\n", // Missing lat/lon
		);

		zip.file(
			"routes.txt",
			"route_id,route_short_name,route_long_name,route_type\n" +
				"route1,1,Test Route,3\n",
		);

		zip.file(
			"trips.txt",
			"route_id,service_id,trip_id\n" + "route1,service1,trip1\n",
		);

		zip.file(
			"stop_times.txt",
			"trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
				"trip1,08:00:00,08:00:00,stop1,1\n",
		);

		zip.file(
			"calendar.txt",
			"service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
				"service1,1,1,1,1,1,0,0,20240101,20241231\n",
		);

		const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		const result = await controller.importGtfsUrl({
			body: {
				dataset: "invalid-agency",
				url: base64Data,
			},
		});

		expect(result.success).toBe(false);
		expect(result.message).toContain("invalid or missing latitude/longitude");
	});

	it("should list all datasets", async ({ expect }) => {
		const { controller } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await controller.importGtfsUrl({
			body: {
				dataset: "test-agency-1",
				url: base64Data,
			},
		});

		const datasets = await controller.listDatasets();
		const dataset = datasets.datasets.find((d) => d.name === "test-agency-1");
		expect(dataset).toBeTruthy();
		expect(dataset?.name).toBe("test-agency-1");
	});

	it("should delete a dataset", async ({ expect }) => {
		const { controller } = await createTest();
		const zipBuffer = loadSampleFeed();
		const base64Data = `data:application/zip;base64,${zipBuffer.toString("base64")}`;

		await controller.importGtfsUrl({
			body: {
				dataset: "test-agency-delete",
				url: base64Data,
			},
		});

		const result = await controller.deleteDataset({
			params: {
				dataset: "test-agency-delete",
			},
		});

		expect(result.success).toBe(true);

		const datasets = await controller.listDatasets();
		const dataset = datasets.datasets.find(
			(d) => d.name === "test-agency-delete",
		);
		expect(dataset).toBeUndefined();
	});
});

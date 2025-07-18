import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { $bucket, AlephaBucket } from "../src";
import { InvalidFileError } from "../src/errors/InvalidFileError.ts";

class TestApp {
	images = $bucket({
		maxSize: 1, // MB
		mimeTypes: ["image/png", "image/jpeg"],
	});
}

const alepha = Alepha.create().with(AlephaBucket).with(TestApp);

describe("$bucket", () => {
	test("should reject mimeTypes", async ({ expect }) => {
		const app = alepha.get(TestApp);
		const file = new File(["test content"], "test.txt", { type: "text/plain" });

		await expect(app.images.upload(file)).rejects.toThrow(InvalidFileError);
	});

	test("should reject file size", async ({ expect }) => {
		const app = alepha.get(TestApp);
		const largeFile = new File(["a".repeat(2 * 1024 * 1024)], "large.png", {
			type: "image/png",
		});

		await expect(() => app.images.upload(largeFile)).rejects.toThrow(
			InvalidFileError,
		);
	});

	test("should upload and download files", async ({ expect }) => {
		const app = alepha.get(TestApp);
		const file = new File(["test content"], "test.png", { type: "image/png" });

		const fileId = await app.images.upload(file);
		expect(fileId).toBeDefined();

		const downloadedFile = await app.images.download(fileId);
		expect(downloadedFile.name).toBe("test.png");
		expect(downloadedFile.type).toBe("image/png");
		expect(downloadedFile.size).toBe(file.size);
	});

	test("should call events on upload and delete", async ({ expect }) => {
		const app = alepha.get(TestApp);
		const file = new File(["test content"], "test.png");

		let uploadEventCalled = false;
		let deleteEventCalled = false;

		alepha.on("bucket:file:uploaded", (file) => {
			expect(file.id).toBeDefined();
			expect(file.name).toBe("test.png");
			expect(file.type).toBe("image/png");
			expect(file.size).toBe(file.size);
			uploadEventCalled = true;
		});

		alepha.on("bucket:file:deleted", (file) => {
			expect(file.id).toBeDefined();
			deleteEventCalled = true;
		});

		const fileId = await app.images.upload(file);
		expect(uploadEventCalled).toBe(true);

		await app.images.delete(fileId);
		expect(deleteEventCalled).toBe(true);
	});
});

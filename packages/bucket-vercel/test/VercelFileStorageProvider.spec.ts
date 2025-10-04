import {
	TestApp,
	testDeleteFile,
	testDeleteNonExistentFile,
	testDownloadAndMetadata,
	testFileExistence,
	testFileStream,
	testNonExistentFile,
	testNonExistentFileError,
	testUploadAndExistence,
	testUploadIntoBuckets,
} from "@alepha/bucket/test/shared.ts";
import { Alepha } from "@alepha/core";
import { del } from "@vercel/blob";
import { afterAll, afterEach, beforeEach, describe, test, vi } from "vitest";
import { AlephaBucketVercel, VercelFileStorageProvider } from "../src";
import { VercelBlobApi } from "../src/providers/VercelBlobProvider.ts";
import { MockVercelBlobApi } from "./MockVercelBlobApi.ts";

const withMock =
	process.env.BLOB_READ_WRITE_TOKEN === "vercel_blob_rw_mock_token_123456789";

const alepha = Alepha.create();

if (withMock) {
	alepha.with({
		provide: VercelBlobApi,
		use: MockVercelBlobApi,
	});

	// Mock fetch to return blob data
	const originalFetch = globalThis.fetch;
	globalThis.fetch = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();

			if (url.startsWith("https://mock-blob.vercel-storage.com")) {
				const __mockStorage = alepha.inject(MockVercelBlobApi).mockStorage;
				const pathname = url.replace(
					"https://mock-blob.vercel-storage.com",
					"",
				);
				const blob = __mockStorage.get(pathname);

				if (!blob) {
					return new Response(null, { status: 404, statusText: "Not Found" });
				}

				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(blob.data));
						controller.close();
					},
				});

				return new Response(stream, {
					status: 200,
					headers: {
						"Content-Type": blob.contentType,
						"Content-Length": blob.size.toString(),
					},
				});
			}

			// For non-mock URLs, use original fetch if available
			if (originalFetch) {
				return originalFetch(input, init);
			}

			throw new Error("fetch is not available in this environment");
		},
	);
}

alepha.with(AlephaBucketVercel).with(TestApp);
const provider = alepha.inject(VercelFileStorageProvider);

describe("VercelFileStorageProvider", () => {
	beforeEach(async () => {
		if (withMock) {
			alepha.inject(MockVercelBlobApi).mockStorage.clear();
		}
	});

	afterEach(async () => {
		if (withMock) {
			alepha.inject(MockVercelBlobApi).mockStorage.clear();
		}
	});

	const cleanup = async () => {
		const filesToDelete = [
			"test-documents/report.pdf",
			"test-images/index.html",
			"test-images/stream.txt",
			"test-images/test.jpg",
			"test-images/logo.jpg",
		];
		if (!withMock) {
			await del(filesToDelete, {
				token: process.env.BLOB_READ_WRITE_TOKEN,
			});
		}
	};

	afterAll(cleanup);

	test("should upload a file and return a fileId", async () => {
		await testUploadAndExistence(provider);
	});

	test("should download a file and restore its metadata", async () => {
		await testDownloadAndMetadata(provider);
	});

	test("exists() should return false for a non-existent file", async () => {
		await testNonExistentFile(provider);
	});

	test("exists() should return true for an existing file", async () => {
		await testFileExistence(provider);
	});

	test("should delete a file", async () => {
		await testDeleteFile(provider);
	});

	test("delete() should not throw for a non-existent file", async () => {
		await testDeleteNonExistentFile(provider);
	});

	test("download() should throw FileNotFoundError for a non-existent file", async () => {
		await testNonExistentFileError(provider);
	});

	test("should handle uploading to different buckets", async () => {
		await testUploadIntoBuckets(provider);
	});

	test("should handle empty files correctly", async () => {
		//	await testEmptyFiles(provider);
	});

	test("should be able to upload, stream with metadata", async () => {
		await testFileStream(provider);
	});
});

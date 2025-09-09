import {
	TestApp,
	testDeleteFile,
	testDeleteNonExistentFile,
	testDownloadAndMetadata,
	testEmptyFiles,
	testFileExistence,
	testFileStream,
	testNonExistentFile,
	testNonExistentFileError,
	testUploadAndExistence,
	testUploadIntoBuckets,
} from "@alepha/bucket/test/shared.ts";
import { Alepha } from "@alepha/core";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import { AlephaBucketVercel, VercelFileStorageProvider } from "../src";

// Mock @vercel/blob before importing the provider
vi.mock("@vercel/blob", async () => {
	const mockStorage = new Map<string, any>();

	const log = (...args: any[]) => {
		//	log("[@vercel/blob mock]", ...args);
	};

	return {
		put: vi.fn(async (pathname: string, body: any, options: any = {}) => {
			// Handle ReadableStream from file.stream()
			log("Mock put received body type:", typeof body, body.constructor?.name);
			let data: Buffer;

			if (body && typeof body.getReader === "function") {
				// It's a Web ReadableStream
				const reader = body.getReader();
				const chunks: Uint8Array[] = [];

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					chunks.push(value);
				}

				// Combine all chunks into a single buffer
				const totalLength = chunks.reduce(
					(sum, chunk) => sum + chunk.length,
					0,
				);
				const combined = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					combined.set(chunk, offset);
					offset += chunk.length;
				}
				data = Buffer.from(combined);
			} else if (body && body.constructor?.name === "Readable") {
				// It's a Node.js Readable stream
				const chunks: Buffer[] = [];

				for await (const chunk of body) {
					chunks.push(Buffer.from(chunk));
				}

				data = Buffer.concat(chunks);
			} else if (Buffer.isBuffer(body)) {
				data = body;
			} else if (body instanceof ArrayBuffer) {
				data = Buffer.from(body);
			} else {
				data = Buffer.from(String(body));
			}

			const blob = {
				pathname,
				data,
				contentType: options.contentType || "application/octet-stream",
				size: data.length,
				uploadedAt: new Date(),
				url: `https://mock-blob.vercel-storage.com${pathname}`,
			};

			log("Mock put storing blob:", {
				pathname,
				dataLength: data.length,
				dataContent: data.toString().slice(0, 50),
			});
			mockStorage.set(pathname, blob);

			return {
				url: blob.url,
				pathname,
				size: blob.size,
				uploadedAt: blob.uploadedAt.toISOString(),
				contentType: blob.contentType,
			};
		}),
		head: vi.fn(async (pathname: string, options: any = {}) => {
			const blob = mockStorage.get(pathname);

			if (!blob) {
				return null;
			}

			return {
				url: blob.url,
				pathname,
				size: blob.size,
				uploadedAt: blob.uploadedAt.toISOString(),
				contentType: blob.contentType,
			};
		}),
		del: vi.fn(async (pathname: string, options: any = {}) => {
			const existed = mockStorage.delete(pathname);
			return { success: existed };
		}),
		// Export mock storage for clearing in tests
		__mockStorage: mockStorage,
	};
});

// Mock fetch to return blob data
const originalFetch = globalThis.fetch;
globalThis.fetch = vi.fn(
	async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();

		if (url.startsWith("https://mock-blob.vercel-storage.com")) {
			const { __mockStorage } = (await import("@vercel/blob")) as any;
			const pathname = url.replace("https://mock-blob.vercel-storage.com", "");
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

const alepha = Alepha.create().with(AlephaBucketVercel).with(TestApp);
const provider = alepha.inject(VercelFileStorageProvider);

describe("VercelFileStorageProvider", () => {
	beforeEach(async () => {
		const { __mockStorage } = (await import("@vercel/blob")) as any;
		__mockStorage.clear();
	});

	afterEach(async () => {
		const { __mockStorage } = (await import("@vercel/blob")) as any;
		__mockStorage.clear();
	});

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
		await testEmptyFiles(provider);
	});

	test("should be able to upload, stream with metadata", async () => {
		await testFileStream(provider);
	});
});

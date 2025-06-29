import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bufferToArrayBuffer,
	file,
	streamToBuffer,
} from "../src/helpers/file.ts";

describe("file", () => {
	describe("with string source", () => {
		it("should create FileLike object from string", async () => {
			const content = "hello world";
			const fileLike = file(content, { name: "test.txt", type: "text/plain" });

			expect(fileLike.name).toBe("test.txt");
			expect(fileLike.type).toBe("text/plain");
			expect(fileLike.size).toBe(Buffer.from(content, "utf-8").byteLength);
			expect(fileLike.lastModified).toBeCloseTo(Date.now(), -2);

			const text = await fileLike.text();
			expect(text).toBe(content);

			const arrayBuffer = await fileLike.arrayBuffer();
			expect(arrayBuffer.byteLength).toBe(
				Buffer.from(content, "utf-8").byteLength,
			);
		});

		it("should use default values when options not provided", async () => {
			const content = "test content";
			const fileLike = file(content);

			expect(fileLike.name).toBe("file");
			expect(fileLike.type).toBe("application/octet-stream");
			expect(fileLike.size).toBe(Buffer.from(content, "utf-8").byteLength);
		});

		it("should infer content type from filename", async () => {
			const fileLike = file('{"key": "value"}', { name: "data.json" });

			expect(fileLike.type).toBe("application/json");
			expect(fileLike.name).toBe("data.json");
		});
	});

	describe("with Buffer source", () => {
		it("should create FileLike object from Buffer", async () => {
			const buffer = Buffer.from("buffer content", "utf-8");
			const fileLike = file(buffer, {
				name: "test.bin",
				type: "application/octet-stream",
			});

			expect(fileLike.name).toBe("test.bin");
			expect(fileLike.type).toBe("application/octet-stream");
			expect(fileLike.size).toBe(buffer.byteLength);

			const text = await fileLike.text();
			expect(text).toBe("buffer content");

			const arrayBuffer = await fileLike.arrayBuffer();
			expect(arrayBuffer.byteLength).toBe(buffer.byteLength);
		});
	});

	describe("with ArrayBuffer source", () => {
		it("should create FileLike object from ArrayBuffer", async () => {
			const originalBuffer = Buffer.from("arraybuffer content", "utf-8");
			const arrayBuffer = bufferToArrayBuffer(originalBuffer);
			const fileLike = file(arrayBuffer, { name: "test.dat" });

			expect(fileLike.name).toBe("test.dat");
			expect(fileLike.size).toBe(arrayBuffer.byteLength);

			const text = await fileLike.text();
			expect(text).toBe("arraybuffer content");
		});
	});

	describe("with Readable stream source", () => {
		it("should create FileLike object from Readable stream - text()", async () => {
			const content = "stream content";
			const stream = Readable.from([content]);

			const fileLike = file(stream, { name: "stream.txt", type: "text/plain" });

			expect(fileLike.name).toBe("stream.txt");
			expect(fileLike.type).toBe("text/plain");
			expect(fileLike.size).toBe(0); // Size is 0 for streams

			const text = await fileLike.text();
			expect(text).toBe(content);
		});

		it("should create FileLike object from Readable stream - arrayBuffer()", async () => {
			const content = "stream content";
			const stream = Readable.from([content]);

			const fileLike = file(stream, { name: "stream.txt", type: "text/plain" });

			const arrayBuffer = await fileLike.arrayBuffer();
			expect(arrayBuffer.byteLength).toBe(
				Buffer.from(content, "utf-8").byteLength,
			);
		});

		it("should handle NodeWebStream", async () => {
			const content = "web stream content";
			const webStream = new NodeWebStream({
				start(controller) {
					controller.enqueue(content);
					controller.close();
				},
			});

			const fileLike = file(webStream, { name: "webstream.txt" });

			expect(fileLike.name).toBe("webstream.txt");
			expect(fileLike.size).toBe(0);

			const text = await fileLike.text();
			expect(text).toBe(content);
		});
	});

	describe("stream method", () => {
		it("should return a readable stream for buffer-based FileLike", async () => {
			const content = "stream test";
			const fileLike = file(content);
			const stream = fileLike.stream();

			expect(stream).toBeInstanceOf(Readable);

			const buffer = await streamToBuffer(stream);
			expect(buffer.toString("utf-8")).toBe(content);
		});

		it("should return the original stream for stream-based FileLike", async () => {
			const content = "original stream";
			const originalStream = new Readable({
				read() {
					this.push(content);
					this.push(null);
				},
			});

			const fileLike = file(originalStream);
			const returnedStream = fileLike.stream();

			expect(returnedStream).toBe(originalStream);
		});
	});

	describe("with URL sources", () => {
		let tempDir: string;
		let testFilePath: string;
		let testFileUrl: string;

		beforeEach(async () => {
			tempDir = join(tmpdir(), `file-utils-test-${Date.now()}`);
			await mkdir(tempDir, { recursive: true });
			testFilePath = join(tempDir, "test.txt");
			testFileUrl = `file://${testFilePath}`;
			await writeFile(testFilePath, "Hello from file!");
		});

		afterEach(async () => {
			try {
				await unlink(testFilePath);
			} catch {
				// Ignore cleanup errors
			}
		});

		it("should create FileLike object from file:// URL", async () => {
			const fileLike = file(testFileUrl, { name: "custom.txt" });

			expect(fileLike.name).toBe("custom.txt");
			expect(fileLike.type).toBe("text/plain");
			expect(fileLike.size).toBe(0); // Size is 0 for URL-based files until loaded

			const text = await fileLike.text();
			expect(text).toBe("Hello from file!");

			const arrayBuffer = await fileLike.arrayBuffer();
			expect(arrayBuffer.byteLength).toBe(
				Buffer.from("Hello from file!").byteLength,
			);
		});

		it("should infer filename from file:// URL path", async () => {
			const fileLike = file(testFileUrl);

			expect(fileLike.name).toBe("test.txt");
			expect(fileLike.type).toBe("text/plain");
		});

		it("should handle file:// URL stream", async () => {
			const fileLike = file(testFileUrl);
			const stream = fileLike.stream();

			expect(stream).toBeInstanceOf(Readable);

			const buffer = await streamToBuffer(stream);
			expect(buffer.toString("utf-8")).toBe("Hello from file!");
		});

		it("should handle HTTP URL with mocked fetch", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				arrayBuffer: async () =>
					bufferToArrayBuffer(Buffer.from("HTTP content")),
			};

			// Mock fetch globally
			global.fetch = vi.fn().mockResolvedValue(mockResponse);

			const httpUrl = "https://example.com/data.txt";
			const fileLike = file(httpUrl);

			expect(fileLike.name).toBe("data.txt");
			expect(fileLike.type).toBe("text/plain");

			const text = await fileLike.text();
			expect(text).toBe("HTTP content");

			expect(global.fetch).toHaveBeenCalledWith(httpUrl);

			// Cleanup
			vi.restoreAllMocks();
		});

		it("should handle HTTP fetch errors", async () => {
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: "Not Found",
			};

			global.fetch = vi.fn().mockResolvedValue(mockResponse);

			const httpUrl = "https://example.com/nonexistent.txt";
			const fileLike = file(httpUrl);

			await expect(fileLike.text()).rejects.toThrow(
				"Failed to fetch https://example.com/nonexistent.txt: 404 Not Found",
			);

			vi.restoreAllMocks();
		});

		it("should handle URL with no filename in path", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				arrayBuffer: async () => Buffer.from("Root content").buffer,
			};

			global.fetch = vi.fn().mockResolvedValue(mockResponse);

			const httpUrl = "https://example.com/";
			const fileLike = file(httpUrl);

			expect(fileLike.name).toBe("file"); // Default name when no filename in path

			vi.restoreAllMocks();
		});
	});

	describe("edge cases", () => {
		it("should handle empty string", async () => {
			const fileLike = file("");

			expect(fileLike.size).toBe(0);
			expect(await fileLike.text()).toBe("");
			expect((await fileLike.arrayBuffer()).byteLength).toBe(0);
		});

		it("should handle unicode content", async () => {
			const content = "Hello 世界 🌍";
			const fileLike = file(content);

			expect(await fileLike.text()).toBe(content);
			expect(fileLike.size).toBe(Buffer.from(content, "utf-8").byteLength);
		});

		it("should override inferred content type with explicit type", () => {
			const fileLike = file('{"key": "value"}', {
				name: "data.json",
				type: "text/plain",
			});

			expect(fileLike.type).toBe("text/plain");
		});
	});
});

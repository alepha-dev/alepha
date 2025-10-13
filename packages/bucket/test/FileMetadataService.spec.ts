import { Alepha } from "@alepha/core";
import { createFile } from "@alepha/file";
import { describe, expect, test } from "vitest";
import { FileMetadataService } from "../src";

describe("FileMetadataService", () => {
	const alepha = Alepha.create();
	const service = alepha.inject(FileMetadataService);

	describe("encodeMetadata", () => {
		test("should encode file metadata into header and metadata buffers", () => {
			const file = createFile("test content", {
				name: "test.txt",
				type: "text/plain",
			});

			const { header, metadata } = service.encodeMetadata(file);

			// Header should be 4 bytes
			expect(header.length).toBe(FileMetadataService.METADATA_HEADER_LENGTH);

			// Header should contain the metadata length as UInt32BE
			const metadataLength = header.readUInt32BE(0);
			expect(metadataLength).toBe(metadata.length);

			// Metadata should be valid JSON
			const decoded = JSON.parse(metadata.toString("utf8"));
			expect(decoded).toEqual({
				name: "test.txt",
				type: "text/plain",
			});
		});

		test("should encode metadata from plain object", () => {
			const metadata = {
				name: "document.pdf",
				type: "application/pdf",
			};

			const { header, metadata: metadataBuffer } =
				service.encodeMetadata(metadata);

			expect(header.length).toBe(4);
			const decoded = JSON.parse(metadataBuffer.toString("utf8"));
			expect(decoded).toEqual(metadata);
		});

		test("should handle special characters in file names", () => {
			const file = createFile("content", {
				name: "файл с эмодзи 🚀.txt",
				type: "text/plain",
			});

			const { metadata } = service.encodeMetadata(file);
			const decoded = JSON.parse(metadata.toString("utf8"));

			expect(decoded.name).toBe("файл с эмодзи 🚀.txt");
		});

		test("should handle long file names", () => {
			const longName = `${"a".repeat(1000)}.txt`;
			const file = createFile("content", {
				name: longName,
				type: "text/plain",
			});

			const { header, metadata } = service.encodeMetadata(file);
			const metadataLength = header.readUInt32BE(0);

			expect(metadataLength).toBe(metadata.length);

			const decoded = JSON.parse(metadata.toString("utf8"));
			expect(decoded.name).toBe(longName);
		});
	});

	describe("decodeMetadata", () => {
		test("should decode metadata from file handle", async () => {
			const originalMetadata = {
				name: "test-file.txt",
				type: "text/plain",
			};

			// Create a buffer with encoded metadata
			const { header, metadata } = service.encodeMetadata(originalMetadata);
			const buffer = Buffer.concat([header, metadata, Buffer.from("content")]);

			// Create a mock file handle
			const mockFileHandle = {
				read: async (
					targetBuffer: Buffer,
					offset: number,
					length: number,
					position: number,
				) => {
					buffer.copy(targetBuffer, offset, position, position + length);
					return { bytesRead: length };
				},
			};

			const { metadata: decoded, contentStart } =
				await service.decodeMetadata(mockFileHandle);

			expect(decoded).toEqual(originalMetadata);
			expect(contentStart).toBe(header.length + metadata.length);
		});

		test("should correctly calculate content start position", async () => {
			const metadata = {
				name: "file.pdf",
				type: "application/pdf",
			};

			const { header, metadata: metadataBuffer } =
				service.encodeMetadata(metadata);
			const content = Buffer.from("PDF content here");
			const buffer = Buffer.concat([header, metadataBuffer, content]);

			const mockFileHandle = {
				read: async (
					targetBuffer: Buffer,
					offset: number,
					length: number,
					position: number,
				) => {
					buffer.copy(targetBuffer, offset, position, position + length);
					return { bytesRead: length };
				},
			};

			const { contentStart } = await service.decodeMetadata(mockFileHandle);

			// Content should start after header + metadata
			expect(contentStart).toBe(4 + metadataBuffer.length);

			// Verify we can read the content from the correct position
			const actualContent = buffer.subarray(contentStart);
			expect(actualContent.toString()).toBe("PDF content here");
		});

		test("should handle metadata with special characters", async () => {
			const metadata = {
				name: "документ 📄.txt",
				type: "text/plain; charset=utf-8",
			};

			const { header, metadata: metadataBuffer } =
				service.encodeMetadata(metadata);
			const buffer = Buffer.concat([header, metadataBuffer]);

			const mockFileHandle = {
				read: async (
					targetBuffer: Buffer,
					offset: number,
					length: number,
					position: number,
				) => {
					buffer.copy(targetBuffer, offset, position, position + length);
					return { bytesRead: length };
				},
			};

			const { metadata: decoded } =
				await service.decodeMetadata(mockFileHandle);

			expect(decoded).toEqual(metadata);
		});
	});

	describe("decodeMetadataFromBuffer", () => {
		test("should decode metadata from buffer", () => {
			const originalMetadata = {
				name: "image.png",
				type: "image/png",
			};

			const { header, metadata } = service.encodeMetadata(originalMetadata);
			const content = Buffer.from("PNG binary data");
			const buffer = Buffer.concat([header, metadata, content]);

			const { metadata: decoded, contentStart } =
				service.decodeMetadataFromBuffer(buffer);

			expect(decoded).toEqual(originalMetadata);
			expect(contentStart).toBe(header.length + metadata.length);
		});

		test("should correctly identify content in buffer", () => {
			const metadata = { name: "data.json", type: "application/json" };
			const contentData = '{"key": "value"}';

			const { header, metadata: metadataBuffer } =
				service.encodeMetadata(metadata);
			const buffer = Buffer.concat([
				header,
				metadataBuffer,
				Buffer.from(contentData),
			]);

			const { contentStart } = service.decodeMetadataFromBuffer(buffer);
			const actualContent = buffer.subarray(contentStart).toString();

			expect(actualContent).toBe(contentData);
		});

		test("should handle empty content", () => {
			const metadata = { name: "empty.txt", type: "text/plain" };

			const { header, metadata: metadataBuffer } =
				service.encodeMetadata(metadata);
			const buffer = Buffer.concat([header, metadataBuffer]);

			const { metadata: decoded, contentStart } =
				service.decodeMetadataFromBuffer(buffer);

			expect(decoded).toEqual(metadata);
			expect(contentStart).toBe(buffer.length);
		});
	});

	describe("createFileBuffer", () => {
		test("should create complete buffer with metadata and content", () => {
			const file = createFile("Hello World", {
				name: "hello.txt",
				type: "text/plain",
			});
			const content = Buffer.from("Hello World");

			const buffer = service.createFileBuffer(file, content);

			// Decode and verify
			const { metadata, contentStart } =
				service.decodeMetadataFromBuffer(buffer);

			expect(metadata.name).toBe("hello.txt");
			expect(metadata.type).toBe("text/plain");

			const actualContent = buffer.subarray(contentStart).toString();
			expect(actualContent).toBe("Hello World");
		});

		test("should handle binary content", () => {
			const metadata = { name: "binary.dat", type: "application/octet-stream" };
			const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);

			const buffer = service.createFileBuffer(metadata, binaryContent);
			const { contentStart } = service.decodeMetadataFromBuffer(buffer);

			const actualContent = buffer.subarray(contentStart);
			expect(actualContent).toEqual(binaryContent);
		});

		test("should handle empty content", () => {
			const metadata = { name: "empty.txt", type: "text/plain" };
			const emptyContent = Buffer.from("");

			const buffer = service.createFileBuffer(metadata, emptyContent);
			const { metadata: decoded, contentStart } =
				service.decodeMetadataFromBuffer(buffer);

			expect(decoded).toEqual(metadata);
			expect(buffer.subarray(contentStart).length).toBe(0);
		});

		test("should handle large content", () => {
			const metadata = { name: "large.bin", type: "application/octet-stream" };
			const largeContent = Buffer.alloc(1024 * 1024); // 1MB
			largeContent.fill(0x42);

			const buffer = service.createFileBuffer(metadata, largeContent);
			const { contentStart } = service.decodeMetadataFromBuffer(buffer);

			const actualContent = buffer.subarray(contentStart);
			expect(actualContent.length).toBe(1024 * 1024);
			expect(actualContent[0]).toBe(0x42);
			expect(actualContent[actualContent.length - 1]).toBe(0x42);
		});
	});

	describe("integration with encoding/decoding", () => {
		test("should encode and decode round-trip successfully", async () => {
			const originalFile = createFile("Round trip test content", {
				name: "roundtrip.txt",
				type: "text/plain",
			});

			// Encode
			const { header, metadata } = service.encodeMetadata(originalFile);
			const content = Buffer.from("Round trip test content");
			const buffer = Buffer.concat([header, metadata, content]);

			// Decode from buffer
			const { metadata: decoded, contentStart } =
				service.decodeMetadataFromBuffer(buffer);

			expect(decoded.name).toBe(originalFile.name);
			expect(decoded.type).toBe(originalFile.type);
			expect(buffer.subarray(contentStart).toString()).toBe(
				"Round trip test content",
			);

			// Also test decode from file handle
			const mockFileHandle = {
				read: async (
					targetBuffer: Buffer,
					offset: number,
					length: number,
					position: number,
				) => {
					buffer.copy(targetBuffer, offset, position, position + length);
					return { bytesRead: length };
				},
			};

			const { metadata: decodedFromHandle } =
				await service.decodeMetadata(mockFileHandle);

			expect(decodedFromHandle).toEqual(decoded);
		});

		test("should maintain data integrity with various content types", () => {
			const testCases = [
				{
					name: "text.txt",
					type: "text/plain",
					content: "Simple text",
				},
				{
					name: "json.json",
					type: "application/json",
					content: '{"key": "value"}',
				},
				{
					name: "html.html",
					type: "text/html",
					content: "<html><body>Test</body></html>",
				},
				{
					name: "unicode.txt",
					type: "text/plain",
					content: "Unicode: 你好世界 🌍",
				},
			];

			for (const testCase of testCases) {
				const metadata = { name: testCase.name, type: testCase.type };
				const contentBuffer = Buffer.from(testCase.content);

				const buffer = service.createFileBuffer(metadata, contentBuffer);
				const { metadata: decoded, contentStart } =
					service.decodeMetadataFromBuffer(buffer);

				expect(decoded).toEqual(metadata);
				expect(buffer.subarray(contentStart).toString()).toBe(testCase.content);
			}
		});
	});
});

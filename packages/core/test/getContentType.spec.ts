import { describe, expect, it } from "vitest";
import { getContentType } from "../src/helpers/getContentType";

describe("getContentType", () => {
	it("should return correct MIME type for known extensions", () => {
		// Document types
		expect(getContentType("test.json")).toBe("application/json");
		expect(getContentType("test.txt")).toBe("text/plain");
		expect(getContentType("test.html")).toBe("text/html");
		expect(getContentType("test.htm")).toBe("text/html");
		expect(getContentType("test.xml")).toBe("application/xml");
		expect(getContentType("test.csv")).toBe("text/csv");
		expect(getContentType("test.pdf")).toBe("application/pdf");
		expect(getContentType("test.md")).toBe("text/markdown");
		expect(getContentType("test.markdown")).toBe("text/markdown");
		expect(getContentType("test.rtf")).toBe("application/rtf");

		// Stylesheet and scripts
		expect(getContentType("test.css")).toBe("text/css");
		expect(getContentType("test.js")).toBe("application/javascript");
		expect(getContentType("test.mjs")).toBe("application/javascript");
		expect(getContentType("test.ts")).toBe("application/typescript");
		expect(getContentType("test.jsx")).toBe("text/jsx");
		expect(getContentType("test.tsx")).toBe("text/tsx");

		// Archive formats
		expect(getContentType("test.zip")).toBe("application/zip");
		expect(getContentType("test.rar")).toBe("application/vnd.rar");
		expect(getContentType("test.7z")).toBe("application/x-7z-compressed");
		expect(getContentType("test.tar")).toBe("application/x-tar");
		expect(getContentType("test.gz")).toBe("application/gzip");
		expect(getContentType("test.tar.gz")).toBe("application/gzip");
		expect(getContentType("test.tgz")).toBe("application/gzip");

		// Image formats
		expect(getContentType("test.png")).toBe("image/png");
		expect(getContentType("test.jpg")).toBe("image/jpeg");
		expect(getContentType("test.jpeg")).toBe("image/jpeg");
		expect(getContentType("test.gif")).toBe("image/gif");
		expect(getContentType("test.webp")).toBe("image/webp");
		expect(getContentType("test.svg")).toBe("image/svg+xml");
		expect(getContentType("test.bmp")).toBe("image/bmp");
		expect(getContentType("test.ico")).toBe("image/x-icon");
		expect(getContentType("test.tiff")).toBe("image/tiff");
		expect(getContentType("test.tif")).toBe("image/tiff");

		// Audio formats
		expect(getContentType("test.mp3")).toBe("audio/mpeg");
		expect(getContentType("test.wav")).toBe("audio/wav");
		expect(getContentType("test.ogg")).toBe("audio/ogg");
		expect(getContentType("test.m4a")).toBe("audio/mp4");
		expect(getContentType("test.aac")).toBe("audio/aac");
		expect(getContentType("test.flac")).toBe("audio/flac");

		// Video formats
		expect(getContentType("test.mp4")).toBe("video/mp4");
		expect(getContentType("test.webm")).toBe("video/webm");
		expect(getContentType("test.avi")).toBe("video/x-msvideo");
		expect(getContentType("test.mov")).toBe("video/quicktime");
		expect(getContentType("test.wmv")).toBe("video/x-ms-wmv");
		expect(getContentType("test.flv")).toBe("video/x-flv");
		expect(getContentType("test.mkv")).toBe("video/x-matroska");

		// Office documents
		expect(getContentType("test.doc")).toBe("application/msword");
		expect(getContentType("test.docx")).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		expect(getContentType("test.xls")).toBe("application/vnd.ms-excel");
		expect(getContentType("test.xlsx")).toBe(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		expect(getContentType("test.ppt")).toBe("application/vnd.ms-powerpoint");
		expect(getContentType("test.pptx")).toBe(
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		);

		// Other formats
		expect(getContentType("test.woff")).toBe("font/woff");
		expect(getContentType("test.woff2")).toBe("font/woff2");
		expect(getContentType("test.ttf")).toBe("font/ttf");
		expect(getContentType("test.otf")).toBe("font/otf");
		expect(getContentType("test.eot")).toBe("application/vnd.ms-fontobject");
	});

	it("should return default MIME type for unknown extensions", () => {
		expect(getContentType("test.unknown")).toBe("application/octet-stream");
		expect(getContentType("test")).toBe("application/octet-stream");
		expect(getContentType("")).toBe("application/octet-stream");
	});

	it("should handle filenames with multiple dots", () => {
		expect(getContentType("test.backup.json")).toBe("application/json");
		expect(getContentType("my.file.name.txt")).toBe("text/plain");
	});

	it("should be case sensitive", () => {
		expect(getContentType("test.JSON")).toBe("application/octet-stream");
		expect(getContentType("test.TXT")).toBe("application/octet-stream");
	});
});

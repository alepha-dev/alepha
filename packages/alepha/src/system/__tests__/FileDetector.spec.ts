import { Readable } from "node:stream";
import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { AlephaSystem } from "../index.ts";
import { FileDetector } from "../services/FileDetector.ts";

/**
 * Helper to create a readable stream from a buffer
 */
function createStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

/**
 * Helper to read all data from a stream
 */
async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe("FileDetector", () => {
  let detector: FileDetector;

  beforeEach(() => {
    const alepha = Alepha.create().with(AlephaSystem);
    detector = alepha.inject(FileDetector);
  });

  describe("getContentType", () => {
    it("should return correct MIME type for known extensions", () => {
      // Document types
      expect(detector.getContentType("test.json")).toBe("application/json");
      expect(detector.getContentType("test.txt")).toBe("text/plain");
      expect(detector.getContentType("test.html")).toBe("text/html");
      expect(detector.getContentType("test.htm")).toBe("text/html");
      expect(detector.getContentType("test.xml")).toBe("application/xml");
      expect(detector.getContentType("test.csv")).toBe("text/csv");
      expect(detector.getContentType("test.pdf")).toBe("application/pdf");
      expect(detector.getContentType("test.md")).toBe("text/markdown");
      expect(detector.getContentType("test.markdown")).toBe("text/markdown");
      expect(detector.getContentType("test.rtf")).toBe("application/rtf");

      // Stylesheet and scripts
      expect(detector.getContentType("test.css")).toBe("text/css");
      expect(detector.getContentType("test.js")).toBe("application/javascript");
      expect(detector.getContentType("test.mjs")).toBe(
        "application/javascript",
      );
      expect(detector.getContentType("test.ts")).toBe("application/typescript");
      expect(detector.getContentType("test.jsx")).toBe("text/jsx");
      expect(detector.getContentType("test.tsx")).toBe("text/tsx");

      // Archive formats
      expect(detector.getContentType("test.zip")).toBe("application/zip");
      expect(detector.getContentType("test.rar")).toBe("application/vnd.rar");
      expect(detector.getContentType("test.7z")).toBe(
        "application/x-7z-compressed",
      );
      expect(detector.getContentType("test.tar")).toBe("application/x-tar");
      expect(detector.getContentType("test.gz")).toBe("application/gzip");
      expect(detector.getContentType("test.tar.gz")).toBe("application/gzip");
      expect(detector.getContentType("test.tgz")).toBe("application/gzip");

      // Image formats
      expect(detector.getContentType("test.png")).toBe("image/png");
      expect(detector.getContentType("test.jpg")).toBe("image/jpeg");
      expect(detector.getContentType("test.jpeg")).toBe("image/jpeg");
      expect(detector.getContentType("test.gif")).toBe("image/gif");
      expect(detector.getContentType("test.webp")).toBe("image/webp");
      expect(detector.getContentType("test.svg")).toBe("image/svg+xml");
      expect(detector.getContentType("test.bmp")).toBe("image/bmp");
      expect(detector.getContentType("test.ico")).toBe("image/x-icon");
      expect(detector.getContentType("test.tiff")).toBe("image/tiff");
      expect(detector.getContentType("test.tif")).toBe("image/tiff");

      // Audio formats
      expect(detector.getContentType("test.mp3")).toBe("audio/mpeg");
      expect(detector.getContentType("test.wav")).toBe("audio/wav");
      expect(detector.getContentType("test.ogg")).toBe("audio/ogg");
      expect(detector.getContentType("test.m4a")).toBe("audio/mp4");
      expect(detector.getContentType("test.aac")).toBe("audio/aac");
      expect(detector.getContentType("test.flac")).toBe("audio/flac");

      // Video formats
      expect(detector.getContentType("test.mp4")).toBe("video/mp4");
      expect(detector.getContentType("test.webm")).toBe("video/webm");
      expect(detector.getContentType("test.avi")).toBe("video/x-msvideo");
      expect(detector.getContentType("test.mov")).toBe("video/quicktime");
      expect(detector.getContentType("test.wmv")).toBe("video/x-ms-wmv");
      expect(detector.getContentType("test.flv")).toBe("video/x-flv");
      expect(detector.getContentType("test.mkv")).toBe("video/x-matroska");

      // Office documents
      expect(detector.getContentType("test.doc")).toBe("application/msword");
      expect(detector.getContentType("test.docx")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(detector.getContentType("test.xls")).toBe(
        "application/vnd.ms-excel",
      );
      expect(detector.getContentType("test.xlsx")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(detector.getContentType("test.ppt")).toBe(
        "application/vnd.ms-powerpoint",
      );
      expect(detector.getContentType("test.pptx")).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );

      // Other formats
      expect(detector.getContentType("test.woff")).toBe("font/woff");
      expect(detector.getContentType("test.woff2")).toBe("font/woff2");
      expect(detector.getContentType("test.ttf")).toBe("font/ttf");
      expect(detector.getContentType("test.otf")).toBe("font/otf");
      expect(detector.getContentType("test.eot")).toBe(
        "application/vnd.ms-fontobject",
      );
    });

    it("should return default MIME type for unknown extensions", () => {
      expect(detector.getContentType("test.unknown")).toBe(
        "application/octet-stream",
      );
      expect(detector.getContentType("test")).toBe("application/octet-stream");
      expect(detector.getContentType("")).toBe("application/octet-stream");
    });

    it("should handle filenames with multiple dots", () => {
      expect(detector.getContentType("test.backup.json")).toBe(
        "application/json",
      );
      expect(detector.getContentType("my.file.name.txt")).toBe("text/plain");
    });
  });

  describe("detectFileType", () => {
    describe("Image formats", () => {
      it("should detect PNG from magic bytes", async () => {
        const pngMagic = Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...Array(8).fill(0),
        ]);
        const stream = createStream(pngMagic);
        const result = await detector.detectFileType(stream, "image.png");

        expect(result.mimeType).toBe("image/png");
        expect(result.extension).toBe("png");
        expect(result.verified).toBe(true);

        // Verify stream is still readable
        const data = await readStream(result.stream);
        expect(data).toEqual(pngMagic);
      });

      it("should detect JPEG from magic bytes", async () => {
        const jpegMagic = Buffer.from([
          0xff,
          0xd8,
          0xff,
          0xe0,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(jpegMagic);
        const result = await detector.detectFileType(stream, "photo.jpg");

        expect(result.mimeType).toBe("image/jpeg");
        expect(result.extension).toBe("jpg");
        expect(result.verified).toBe(true);

        const data = await readStream(result.stream);
        expect(data).toEqual(jpegMagic);
      });

      it("should detect GIF from magic bytes", async () => {
        const gifMagic = Buffer.from([
          0x47,
          0x49,
          0x46,
          0x38,
          0x39,
          0x61,
          ...Array(10).fill(0),
        ]);
        const stream = createStream(gifMagic);
        const result = await detector.detectFileType(stream, "animation.gif");

        expect(result.mimeType).toBe("image/gif");
        expect(result.extension).toBe("gif");
        expect(result.verified).toBe(true);

        const data = await readStream(result.stream);
        expect(data).toEqual(gifMagic);
      });

      it("should detect WebP from magic bytes", async () => {
        const webpMagic = Buffer.from([
          0x52,
          0x49,
          0x46,
          0x46,
          0x00,
          0x00,
          0x00,
          0x00,
          0x57,
          0x45,
          0x42,
          0x50,
          ...Array(4).fill(0),
        ]);
        const stream = createStream(webpMagic);
        const result = await detector.detectFileType(stream, "image.webp");

        expect(result.mimeType).toBe("image/webp");
        expect(result.extension).toBe("webp");
        expect(result.verified).toBe(true);

        const data = await readStream(result.stream);
        expect(data).toEqual(webpMagic);
      });

      it("should detect BMP from magic bytes", async () => {
        const bmpMagic = Buffer.from([0x42, 0x4d, ...Array(14).fill(0)]);
        const stream = createStream(bmpMagic);
        const result = await detector.detectFileType(stream, "image.bmp");

        expect(result.mimeType).toBe("image/bmp");
        expect(result.extension).toBe("bmp");
        expect(result.verified).toBe(true);
      });
    });

    describe("Document formats", () => {
      it("should detect PDF from magic bytes", async () => {
        const pdfMagic = Buffer.from([
          0x25,
          0x50,
          0x44,
          0x46,
          0x2d,
          ...Array(11).fill(0),
        ]);
        const stream = createStream(pdfMagic);
        const result = await detector.detectFileType(stream, "document.pdf");

        expect(result.mimeType).toBe("application/pdf");
        expect(result.extension).toBe("pdf");
        expect(result.verified).toBe(true);

        const data = await readStream(result.stream);
        expect(data).toEqual(pdfMagic);
      });

      it("should detect ZIP from magic bytes", async () => {
        const zipMagic = Buffer.from([
          0x50,
          0x4b,
          0x03,
          0x04,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(zipMagic);
        const result = await detector.detectFileType(stream, "archive.zip");

        expect(result.mimeType).toBe("application/zip");
        expect(result.extension).toBe("zip");
        expect(result.verified).toBe(true);
      });
    });

    describe("Archive formats", () => {
      it("should detect RAR from magic bytes", async () => {
        const rarMagic = Buffer.from([
          0x52,
          0x61,
          0x72,
          0x21,
          0x1a,
          0x07,
          ...Array(10).fill(0),
        ]);
        const stream = createStream(rarMagic);
        const result = await detector.detectFileType(stream, "archive.rar");

        expect(result.mimeType).toBe("application/vnd.rar");
        expect(result.extension).toBe("rar");
        expect(result.verified).toBe(true);
      });

      it("should detect 7z from magic bytes", async () => {
        const sevenZipMagic = Buffer.from([
          0x37,
          0x7a,
          0xbc,
          0xaf,
          0x27,
          0x1c,
          ...Array(10).fill(0),
        ]);
        const stream = createStream(sevenZipMagic);
        const result = await detector.detectFileType(stream, "archive.7z");

        expect(result.mimeType).toBe("application/x-7z-compressed");
        expect(result.extension).toBe("7z");
        expect(result.verified).toBe(true);
      });

      it("should detect GZIP from magic bytes", async () => {
        const gzipMagic = Buffer.from([0x1f, 0x8b, ...Array(14).fill(0)]);
        const stream = createStream(gzipMagic);
        const result = await detector.detectFileType(stream, "archive.gz");

        expect(result.mimeType).toBe("application/gzip");
        expect(result.extension).toBe("gz");
        expect(result.verified).toBe(true);
      });
    });

    describe("Audio formats", () => {
      it("should detect MP3 from magic bytes", async () => {
        const mp3Magic = Buffer.from([0xff, 0xfb, ...Array(14).fill(0)]);
        const stream = createStream(mp3Magic);
        const result = await detector.detectFileType(stream, "song.mp3");

        expect(result.mimeType).toBe("audio/mpeg");
        expect(result.extension).toBe("mp3");
        expect(result.verified).toBe(true);
      });

      it("should detect WAV from magic bytes", async () => {
        const wavMagic = Buffer.from([
          0x52,
          0x49,
          0x46,
          0x46,
          0x00,
          0x00,
          0x00,
          0x00,
          0x57,
          0x41,
          0x56,
          0x45,
          ...Array(4).fill(0),
        ]);
        const stream = createStream(wavMagic);
        const result = await detector.detectFileType(stream, "audio.wav");

        expect(result.mimeType).toBe("audio/wav");
        expect(result.extension).toBe("wav");
        expect(result.verified).toBe(true);
      });

      it("should detect FLAC from magic bytes", async () => {
        const flacMagic = Buffer.from([
          0x66,
          0x4c,
          0x61,
          0x43,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(flacMagic);
        const result = await detector.detectFileType(stream, "audio.flac");

        expect(result.mimeType).toBe("audio/flac");
        expect(result.extension).toBe("flac");
        expect(result.verified).toBe(true);
      });
    });

    describe("Mismatched extension and content", () => {
      it("should detect actual PNG even when extension is .txt", async () => {
        const pngMagic = Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...Array(8).fill(0),
        ]);
        const stream = createStream(pngMagic);
        const result = await detector.detectFileType(stream, "file.txt");

        expect(result.mimeType).toBe("image/png");
        expect(result.extension).toBe("png");
        expect(result.verified).toBe(true);
      });

      it("should detect actual JPEG even when extension is .pdf", async () => {
        const jpegMagic = Buffer.from([
          0xff,
          0xd8,
          0xff,
          0xe1,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(jpegMagic);
        const result = await detector.detectFileType(stream, "document.pdf");

        expect(result.mimeType).toBe("image/jpeg");
        expect(result.extension).toBe("jpg"); // Matches jpg signature first
        expect(result.verified).toBe(true);
      });

      it("should detect actual PDF even when extension is .jpg", async () => {
        const pdfMagic = Buffer.from([
          0x25,
          0x50,
          0x44,
          0x46,
          0x2d,
          ...Array(11).fill(0),
        ]);
        const stream = createStream(pdfMagic);
        const result = await detector.detectFileType(stream, "file.jpg");

        expect(result.mimeType).toBe("application/pdf");
        expect(result.extension).toBe("pdf");
        expect(result.verified).toBe(true);
      });
    });

    describe("Fallback to extension-based detection", () => {
      it("should fall back to extension for text files without magic bytes", async () => {
        const textContent = Buffer.from("Hello, world!", "utf-8");
        const stream = createStream(textContent);
        const result = await detector.detectFileType(stream, "file.txt");

        expect(result.mimeType).toBe("text/plain");
        expect(result.extension).toBe("txt");
        expect(result.verified).toBe(false);

        const data = await readStream(result.stream);
        expect(data.toString("utf-8")).toBe("Hello, world!");
      });

      it("should fall back to extension for JSON files", async () => {
        const jsonContent = Buffer.from('{"key": "value"}', "utf-8");
        const stream = createStream(jsonContent);
        const result = await detector.detectFileType(stream, "data.json");

        expect(result.mimeType).toBe("application/json");
        expect(result.extension).toBe("json");
        expect(result.verified).toBe(false);
      });

      it("should return octet-stream for unknown files without magic bytes", async () => {
        const randomContent = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const stream = createStream(randomContent);
        const result = await detector.detectFileType(stream, "file.unknown");

        expect(result.mimeType).toBe("application/octet-stream");
        expect(result.extension).toBe("unknown");
        expect(result.verified).toBe(false);
      });
    });

    describe("Edge cases", () => {
      it("should handle empty streams", async () => {
        const emptyBuffer = Buffer.from([]);
        const stream = createStream(emptyBuffer);
        const result = await detector.detectFileType(stream, "empty.txt");

        expect(result.mimeType).toBe("text/plain");
        expect(result.extension).toBe("txt");
        expect(result.verified).toBe(false);
      });

      it("should handle streams with less than 16 bytes", async () => {
        const shortBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const stream = createStream(shortBuffer);
        const result = await detector.detectFileType(stream, "incomplete.png");

        // Should not verify because signature is incomplete
        expect(result.verified).toBe(false);
      });

      it("should handle filenames without extensions", async () => {
        const randomContent = Buffer.from([0x01, 0x02, 0x03]);
        const stream = createStream(randomContent);
        const result = await detector.detectFileType(stream, "README");

        expect(result.mimeType).toBe("application/octet-stream");
        expect(result.extension).toBe("");
        expect(result.verified).toBe(false);
      });

      it("should preserve all stream data", async () => {
        const longContent = Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
          Buffer.from("This is some additional data after the header"),
        ]);
        const stream = createStream(longContent);
        const result = await detector.detectFileType(stream, "image.png");

        expect(result.verified).toBe(true);

        // Verify all data is preserved
        const data = await readStream(result.stream);
        expect(data).toEqual(longContent);
      });
    });

    describe("Multiple JPEG variants", () => {
      it("should detect JPEG with 0xFFE1 marker", async () => {
        const jpegMagic = Buffer.from([
          0xff,
          0xd8,
          0xff,
          0xe1,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(jpegMagic);
        const result = await detector.detectFileType(stream, "photo.jpeg");

        expect(result.mimeType).toBe("image/jpeg");
        expect(result.verified).toBe(true);
      });

      it("should detect JPEG with 0xFFE2 marker", async () => {
        const jpegMagic = Buffer.from([
          0xff,
          0xd8,
          0xff,
          0xe2,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(jpegMagic);
        const result = await detector.detectFileType(stream, "photo.jpg");

        expect(result.mimeType).toBe("image/jpeg");
        expect(result.verified).toBe(true);
      });
    });

    describe("Office formats", () => {
      it("should detect old Office format (DOC)", async () => {
        const docMagic = Buffer.from([
          0xd0,
          0xcf,
          0x11,
          0xe0,
          0xa1,
          0xb1,
          0x1a,
          0xe1,
          ...Array(8).fill(0),
        ]);
        const stream = createStream(docMagic);
        const result = await detector.detectFileType(stream, "document.doc");

        expect(result.mimeType).toBe("application/msword");
        expect(result.extension).toBe("doc");
        expect(result.verified).toBe(true);
      });

      it("should detect DOCX (ZIP-based)", async () => {
        const docxMagic = Buffer.from([
          0x50,
          0x4b,
          0x03,
          0x04,
          ...Array(12).fill(0),
        ]);
        const stream = createStream(docxMagic);
        const result = await detector.detectFileType(stream, "document.docx");

        expect(result.mimeType).toBe(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        expect(result.extension).toBe("docx");
        expect(result.verified).toBe(true);
      });
    });
  });
});

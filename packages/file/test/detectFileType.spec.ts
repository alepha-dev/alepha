import { Readable } from "node:stream";
import { describe, it } from "vitest";
import { detectFileType } from "../src/helpers/detectFileType.ts";

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

describe("detectFileType", () => {
  describe("Image formats", () => {
    it("should detect PNG from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "image.png");

      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe("png");
      expect(result.verified).toBe(true);

      // Verify stream is still readable
      const data = await readStream(result.stream);
      expect(data).toEqual(pngMagic);
    });

    it("should detect JPEG from magic bytes", async ({ expect }) => {
      const jpegMagic = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(jpegMagic);
      const result = await detectFileType(stream, "photo.jpg");

      expect(result.mimeType).toBe("image/jpeg");
      expect(result.extension).toBe("jpg");
      expect(result.verified).toBe(true);

      const data = await readStream(result.stream);
      expect(data).toEqual(jpegMagic);
    });

    it("should detect GIF from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "animation.gif");

      expect(result.mimeType).toBe("image/gif");
      expect(result.extension).toBe("gif");
      expect(result.verified).toBe(true);

      const data = await readStream(result.stream);
      expect(data).toEqual(gifMagic);
    });

    it("should detect WebP from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "image.webp");

      expect(result.mimeType).toBe("image/webp");
      expect(result.extension).toBe("webp");
      expect(result.verified).toBe(true);

      const data = await readStream(result.stream);
      expect(data).toEqual(webpMagic);
    });

    it("should detect BMP from magic bytes", async ({ expect }) => {
      const bmpMagic = Buffer.from([0x42, 0x4d, ...Array(14).fill(0)]);
      const stream = createStream(bmpMagic);
      const result = await detectFileType(stream, "image.bmp");

      expect(result.mimeType).toBe("image/bmp");
      expect(result.extension).toBe("bmp");
      expect(result.verified).toBe(true);
    });
  });

  describe("Document formats", () => {
    it("should detect PDF from magic bytes", async ({ expect }) => {
      const pdfMagic = Buffer.from([
        0x25,
        0x50,
        0x44,
        0x46,
        0x2d,
        ...Array(11).fill(0),
      ]);
      const stream = createStream(pdfMagic);
      const result = await detectFileType(stream, "document.pdf");

      expect(result.mimeType).toBe("application/pdf");
      expect(result.extension).toBe("pdf");
      expect(result.verified).toBe(true);

      const data = await readStream(result.stream);
      expect(data).toEqual(pdfMagic);
    });

    it("should detect ZIP from magic bytes", async ({ expect }) => {
      const zipMagic = Buffer.from([
        0x50,
        0x4b,
        0x03,
        0x04,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(zipMagic);
      const result = await detectFileType(stream, "archive.zip");

      expect(result.mimeType).toBe("application/zip");
      expect(result.extension).toBe("zip");
      expect(result.verified).toBe(true);
    });
  });

  describe("Archive formats", () => {
    it("should detect RAR from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "archive.rar");

      expect(result.mimeType).toBe("application/vnd.rar");
      expect(result.extension).toBe("rar");
      expect(result.verified).toBe(true);
    });

    it("should detect 7z from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "archive.7z");

      expect(result.mimeType).toBe("application/x-7z-compressed");
      expect(result.extension).toBe("7z");
      expect(result.verified).toBe(true);
    });

    it("should detect GZIP from magic bytes", async ({ expect }) => {
      const gzipMagic = Buffer.from([0x1f, 0x8b, ...Array(14).fill(0)]);
      const stream = createStream(gzipMagic);
      const result = await detectFileType(stream, "archive.gz");

      expect(result.mimeType).toBe("application/gzip");
      expect(result.extension).toBe("gz");
      expect(result.verified).toBe(true);
    });
  });

  describe("Audio formats", () => {
    it("should detect MP3 from magic bytes", async ({ expect }) => {
      const mp3Magic = Buffer.from([0xff, 0xfb, ...Array(14).fill(0)]);
      const stream = createStream(mp3Magic);
      const result = await detectFileType(stream, "song.mp3");

      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.extension).toBe("mp3");
      expect(result.verified).toBe(true);
    });

    it("should detect WAV from magic bytes", async ({ expect }) => {
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
      const result = await detectFileType(stream, "audio.wav");

      expect(result.mimeType).toBe("audio/wav");
      expect(result.extension).toBe("wav");
      expect(result.verified).toBe(true);
    });

    it("should detect FLAC from magic bytes", async ({ expect }) => {
      const flacMagic = Buffer.from([
        0x66,
        0x4c,
        0x61,
        0x43,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(flacMagic);
      const result = await detectFileType(stream, "audio.flac");

      expect(result.mimeType).toBe("audio/flac");
      expect(result.extension).toBe("flac");
      expect(result.verified).toBe(true);
    });
  });

  describe("Mismatched extension and content", () => {
    it("should detect actual PNG even when extension is .txt", async ({
      expect,
    }) => {
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
      const result = await detectFileType(stream, "file.txt");

      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe("png");
      expect(result.verified).toBe(true);
    });

    it("should detect actual JPEG even when extension is .pdf", async ({
      expect,
    }) => {
      const jpegMagic = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe1,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(jpegMagic);
      const result = await detectFileType(stream, "document.pdf");

      expect(result.mimeType).toBe("image/jpeg");
      expect(result.extension).toBe("jpg"); // Matches jpg signature first
      expect(result.verified).toBe(true);
    });

    it("should detect actual PDF even when extension is .jpg", async ({
      expect,
    }) => {
      const pdfMagic = Buffer.from([
        0x25,
        0x50,
        0x44,
        0x46,
        0x2d,
        ...Array(11).fill(0),
      ]);
      const stream = createStream(pdfMagic);
      const result = await detectFileType(stream, "file.jpg");

      expect(result.mimeType).toBe("application/pdf");
      expect(result.extension).toBe("pdf");
      expect(result.verified).toBe(true);
    });
  });

  describe("Fallback to extension-based detection", () => {
    it("should fall back to extension for text files without magic bytes", async ({
      expect,
    }) => {
      const textContent = Buffer.from("Hello, world!", "utf-8");
      const stream = createStream(textContent);
      const result = await detectFileType(stream, "file.txt");

      expect(result.mimeType).toBe("text/plain");
      expect(result.extension).toBe("txt");
      expect(result.verified).toBe(false);

      const data = await readStream(result.stream);
      expect(data.toString("utf-8")).toBe("Hello, world!");
    });

    it("should fall back to extension for JSON files", async ({ expect }) => {
      const jsonContent = Buffer.from('{"key": "value"}', "utf-8");
      const stream = createStream(jsonContent);
      const result = await detectFileType(stream, "data.json");

      expect(result.mimeType).toBe("application/json");
      expect(result.extension).toBe("json");
      expect(result.verified).toBe(false);
    });

    it("should return octet-stream for unknown files without magic bytes", async ({
      expect,
    }) => {
      const randomContent = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const stream = createStream(randomContent);
      const result = await detectFileType(stream, "file.unknown");

      expect(result.mimeType).toBe("application/octet-stream");
      expect(result.extension).toBe("unknown");
      expect(result.verified).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty streams", async ({ expect }) => {
      const emptyBuffer = Buffer.from([]);
      const stream = createStream(emptyBuffer);
      const result = await detectFileType(stream, "empty.txt");

      expect(result.mimeType).toBe("text/plain");
      expect(result.extension).toBe("txt");
      expect(result.verified).toBe(false);
    });

    it("should handle streams with less than 16 bytes", async ({ expect }) => {
      const shortBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const stream = createStream(shortBuffer);
      const result = await detectFileType(stream, "incomplete.png");

      // Should not verify because signature is incomplete
      expect(result.verified).toBe(false);
    });

    it("should handle filenames without extensions", async ({ expect }) => {
      const randomContent = Buffer.from([0x01, 0x02, 0x03]);
      const stream = createStream(randomContent);
      const result = await detectFileType(stream, "README");

      expect(result.mimeType).toBe("application/octet-stream");
      expect(result.extension).toBe("");
      expect(result.verified).toBe(false);
    });

    it("should preserve all stream data", async ({ expect }) => {
      const longContent = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
        Buffer.from("This is some additional data after the header"),
      ]);
      const stream = createStream(longContent);
      const result = await detectFileType(stream, "image.png");

      expect(result.verified).toBe(true);

      // Verify all data is preserved
      const data = await readStream(result.stream);
      expect(data).toEqual(longContent);
    });
  });

  describe("Multiple JPEG variants", () => {
    it("should detect JPEG with 0xFFE1 marker", async ({ expect }) => {
      const jpegMagic = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe1,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(jpegMagic);
      const result = await detectFileType(stream, "photo.jpeg");

      expect(result.mimeType).toBe("image/jpeg");
      expect(result.verified).toBe(true);
    });

    it("should detect JPEG with 0xFFE2 marker", async ({ expect }) => {
      const jpegMagic = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe2,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(jpegMagic);
      const result = await detectFileType(stream, "photo.jpg");

      expect(result.mimeType).toBe("image/jpeg");
      expect(result.verified).toBe(true);
    });
  });

  describe("Office formats", () => {
    it("should detect old Office format (DOC)", async ({ expect }) => {
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
      const result = await detectFileType(stream, "document.doc");

      expect(result.mimeType).toBe("application/msword");
      expect(result.extension).toBe("doc");
      expect(result.verified).toBe(true);
    });

    it("should detect DOCX (ZIP-based)", async ({ expect }) => {
      const docxMagic = Buffer.from([
        0x50,
        0x4b,
        0x03,
        0x04,
        ...Array(12).fill(0),
      ]);
      const stream = createStream(docxMagic);
      const result = await detectFileType(stream, "document.docx");

      expect(result.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(result.extension).toBe("docx");
      expect(result.verified).toBe(true);
    });
  });
});

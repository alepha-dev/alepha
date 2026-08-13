import { Readable } from "node:stream";
import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { FileDetector } from "../services/FileDetector.ts";

describe("FileDetector — offsets, extensions, content-disposition", () => {
  let detector: FileDetector;

  beforeEach(() => {
    detector = Alepha.create().inject(FileDetector);
  });

  describe("tar detection (offset signature)", () => {
    /**
     * A minimal POSIX tar header: the "ustar" magic sits at byte 257 —
     * an offset-0 check can never match a real archive.
     */
    const tarHeader = (): Buffer => {
      const buf = Buffer.alloc(512);
      buf.write("some-file.txt", 0, "utf-8");
      buf.write("ustar", 257, "utf-8");
      return buf;
    };

    it("verifies a real tar by its offset-257 magic", async () => {
      const result = await detector.detectFileType(
        Readable.from(tarHeader()),
        "archive.tar",
      );
      expect(result.verified).toBe(true);
      expect(result.mimeType).toBe("application/x-tar");
      expect(result.extension).toBe("tar");
    });

    it("does not verify a fake .tar", async () => {
      const result = await detector.detectFileType(
        Readable.from(Buffer.from("definitely not a tar")),
        "archive.tar",
      );
      expect(result.verified).toBe(false);
      expect(result.mimeType).toBe("application/x-tar"); // extension fallback
    });

    it("still hands back the full payload after the deeper peek", async () => {
      const payload = Buffer.concat([tarHeader(), Buffer.from("file-data")]);
      const result = await detector.detectFileType(
        Readable.from(payload),
        "archive.tar",
      );

      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(payload);
    });
  });

  describe("getExtensionFromMimeType", () => {
    it("maps known MIME types to their common extension", () => {
      expect(detector.getExtensionFromMimeType("image/png")).toBe("png");
      expect(detector.getExtensionFromMimeType("image/jpeg")).toBe("jpg");
      expect(detector.getExtensionFromMimeType("application/gzip")).toBe("gz");
      expect(detector.getExtensionFromMimeType("application/json")).toBe(
        "json",
      );
    });

    it("falls back to bin for unknown MIME types", () => {
      expect(
        detector.getExtensionFromMimeType("application/octet-stream"),
      ).toBe("bin");
      expect(detector.getExtensionFromMimeType("x-made/up")).toBe("bin");
    });
  });

  describe("getFilenameFromContentDisposition", () => {
    it("returns undefined for a missing header", () => {
      expect(detector.getFilenameFromContentDisposition(null)).toBeUndefined();
      expect(
        detector.getFilenameFromContentDisposition(undefined),
      ).toBeUndefined();
      expect(
        detector.getFilenameFromContentDisposition("attachment"),
      ).toBeUndefined();
    });

    it("parses a quoted filename", () => {
      expect(
        detector.getFilenameFromContentDisposition(
          'attachment; filename="report final.pdf"',
        ),
      ).toBe("report final.pdf");
    });

    it("parses an unquoted filename", () => {
      expect(
        detector.getFilenameFromContentDisposition(
          "attachment; filename=report.pdf",
        ),
      ).toBe("report.pdf");
    });

    it("decodes the RFC 5987 filename* form instead of mangling it", () => {
      // The old regex captured `*=UTF-8''r%C3%A9sum%C3%A9.pdf` as the name.
      expect(
        detector.getFilenameFromContentDisposition(
          "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
        ),
      ).toBe("résumé.pdf");
    });

    it("prefers filename* over filename when both are present", () => {
      expect(
        detector.getFilenameFromContentDisposition(
          `attachment; filename="fallback.pdf"; filename*=UTF-8''pr%C3%A9cis.pdf`,
        ),
      ).toBe("précis.pdf");
    });
  });

  describe("new mime map entries", () => {
    it("knows the formats the map was missing", () => {
      expect(detector.getContentType("image.avif")).toBe("image/avif");
      expect(detector.getContentType("photo.heic")).toBe("image/heic");
      expect(detector.getContentType("module.wasm")).toBe("application/wasm");
      expect(detector.getContentType("config.yaml")).toBe("application/yaml");
      expect(detector.getContentType("config.yml")).toBe("application/yaml");
      expect(detector.getContentType("config.toml")).toBe("application/toml");
      expect(detector.getContentType("app.webmanifest")).toBe(
        "application/manifest+json",
      );
      expect(detector.getContentType("voice.opus")).toBe("audio/opus");
    });
  });
});

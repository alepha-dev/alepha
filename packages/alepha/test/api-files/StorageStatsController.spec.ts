import { $bucket } from "alepha/bucket";
import { Alepha } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { describe, expect, it } from "vitest";
import { StorageStatsController } from "../../src/api-files/controllers/StorageStatsController.ts";
import { FileService } from "../../src/api-files/services/FileService.ts";

describe("StorageStatsController", () => {
  class App {
    images = $bucket({ name: "images" });
    documents = $bucket({ name: "documents" });
  }

  let createFile: (
    textOrOpts: string | { text: string; name?: string; type?: string },
    opts?: { name?: string; type?: string },
  ) => any;

  const setup = async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const ctrl = alepha.inject(StorageStatsController);
    const service = alepha.inject(FileService);
    const fs = alepha.inject(FileSystemProvider);
    await alepha.start();
    createFile = (
      textOrOpts: string | { text: string; name?: string; type?: string },
      opts?: { name?: string; type?: string },
    ) => {
      if (typeof textOrOpts === "string") {
        return fs.createFile({ text: textOrOpts, ...(opts || {}) });
      }
      return fs.createFile(textOrOpts);
    };
    return { alepha, app, ctrl, service, fs };
  };

  describe("getStats", () => {
    it("should return zero stats when no files exist", async () => {
      const { ctrl } = await setup();

      const stats = await ctrl.getStats();

      expect(stats.totalSize).toBe(0);
      expect(stats.totalFiles).toBe(0);
      expect(stats.byBucket).toEqual([]);
      expect(stats.byMimeType).toEqual([]);
    });

    it("should calculate total size and file count", async () => {
      const { service, ctrl } = await setup();

      await service.uploadFile(createFile("Hello", { name: "file1.txt" })); // 5 bytes
      await service.uploadFile(createFile("World!", { name: "file2.txt" })); // 6 bytes

      const stats = await ctrl.getStats();

      expect(stats.totalSize).toBe(11);
      expect(stats.totalFiles).toBe(2);
    });

    it("should group stats by bucket", async () => {
      const { service, ctrl } = await setup();

      await service.uploadFile(
        createFile("Image data", { name: "img1.png", type: "image/png" }),
        { bucket: "images" },
      );
      await service.uploadFile(
        createFile("Image data 2", { name: "img2.png", type: "image/png" }),
        { bucket: "images" },
      );
      await service.uploadFile(
        createFile("Document", { name: "doc.pdf", type: "application/pdf" }),
        { bucket: "documents" },
      );

      const stats = await ctrl.getStats();

      expect(stats.byBucket).toHaveLength(2);

      const imagesBucket = stats.byBucket.find((b) => b.bucket === "images");
      expect(imagesBucket?.fileCount).toBe(2);
      expect(imagesBucket?.totalSize).toBeGreaterThan(0);

      const docsBucket = stats.byBucket.find((b) => b.bucket === "documents");
      expect(docsBucket?.fileCount).toBe(1);
      expect(docsBucket?.totalSize).toBeGreaterThan(0);
    });

    it("should group stats by MIME type", async () => {
      const { service, ctrl } = await setup();

      await service.uploadFile(
        createFile("Text 1", { name: "file1.txt", type: "text/plain" }),
      );
      await service.uploadFile(
        createFile("Text 2", { name: "file2.txt", type: "text/plain" }),
      );
      await service.uploadFile(
        createFile("PDF data", { name: "doc.pdf", type: "application/pdf" }),
      );

      const stats = await ctrl.getStats();

      expect(stats.byMimeType).toHaveLength(2);

      const textStats = stats.byMimeType.find(
        (m) => m.mimeType === "text/plain",
      );
      expect(textStats?.fileCount).toBe(2);

      const pdfStats = stats.byMimeType.find(
        (m) => m.mimeType === "application/pdf",
      );
      expect(pdfStats?.fileCount).toBe(1);
    });

    it("should provide comprehensive stats with multiple files", async () => {
      const { service, ctrl } = await setup();

      // Upload various files
      await service.uploadFile(
        createFile("A".repeat(100), { name: "file1.txt", type: "text/plain" }),
        { bucket: "images", tags: ["tag1"] },
      );
      await service.uploadFile(
        createFile("B".repeat(200), {
          name: "file2.pdf",
          type: "application/pdf",
        }),
        { bucket: "documents", tags: ["tag2"] },
      );
      await service.uploadFile(
        createFile("C".repeat(150), { name: "file3.txt", type: "text/plain" }),
        { bucket: "images", tags: ["tag1", "tag3"] },
      );

      const stats = await ctrl.getStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(450);
      expect(stats.byBucket.length).toBeGreaterThan(0);
      expect(stats.byMimeType.length).toBeGreaterThan(0);

      // Verify totals match sum of buckets
      const bucketTotalFiles = stats.byBucket.reduce(
        (sum, b) => sum + b.fileCount,
        0,
      );
      expect(bucketTotalFiles).toBe(stats.totalFiles);

      const bucketTotalSize = stats.byBucket.reduce(
        (sum, b) => sum + b.totalSize,
        0,
      );
      expect(bucketTotalSize).toBe(stats.totalSize);

      // Verify totals match sum of MIME types
      const mimeTypeTotalFiles = stats.byMimeType.reduce(
        (sum, m) => sum + m.fileCount,
        0,
      );
      expect(mimeTypeTotalFiles).toBe(stats.totalFiles);
    });
  });
});

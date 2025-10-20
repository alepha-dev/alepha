import { $bucket } from "@alepha/bucket";
import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { createFile } from "@alepha/file";
import { describe, expect, it } from "vitest";
import { FileController } from "../src/controllers/FileController.ts";
import { FileService } from "../src/services/FileService.ts";

describe("FileController", () => {
  class App {
    images = $bucket({});
    documents = $bucket({ name: "documents" });
  }

  const setup = async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const ctrl = alepha.inject(FileController);
    const service = alepha.inject(FileService);
    const dtp = alepha.inject(DateTimeProvider);
    await alepha.start();
    return { alepha, app, ctrl, service, dtp };
  };

  describe("findFiles", () => {
    it("should return files from specific bucket", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("test"));
      const files = await ctrl.findFiles({
        query: { bucket: app.images.name },
      });
      expect(files.content.length).toEqual(1);
    });

    it("should return empty list when no files exist", async () => {
      const { ctrl } = await setup();
      const files = await ctrl.findFiles();
      expect(files.content).toEqual([]);
      expect(files.page.totalElements).toBe(0);
    });

    it("should return files from all buckets when no bucket filter", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("image.png"));
      await app.documents.upload(createFile("doc.pdf"));

      const files = await ctrl.findFiles({ query: {} });
      expect(files.content.length).toEqual(2);
    });

    it("should filter files by bucket", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("image.png"));
      await app.documents.upload(createFile("doc.pdf"));

      const imagesFiles = await ctrl.findFiles({
        query: { bucket: app.images.name },
      });
      expect(imagesFiles.content.length).toEqual(1);
      expect(imagesFiles.content[0].bucket).toBe(app.images.name);

      const docsFiles = await ctrl.findFiles({
        query: { bucket: app.documents.name },
      });
      expect(docsFiles.content.length).toEqual(1);
      expect(docsFiles.content[0].bucket).toBe(app.documents.name);
    });

    it("should filter files by tags", async () => {
      const { service, ctrl } = await setup();
      await service.uploadFile(createFile("file1.txt"), {
        tags: ["important", "work"],
      });
      await service.uploadFile(createFile("file2.txt"), { tags: ["personal"] });
      await service.uploadFile(createFile("file3.txt"), {
        tags: ["important", "personal"],
      });

      const importantFiles = await ctrl.findFiles.run({
        query: { tags: ["important"] },
      });
      expect(importantFiles.content.length).toEqual(2);
    });

    it("should support pagination", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("file1.txt"));
      await app.images.upload(createFile("file2.txt"));
      await app.images.upload(createFile("file3.txt"));

      const page1 = await ctrl.findFiles({
        query: { bucket: app.images.name, size: 2, page: 0 },
      });

      expect(page1.content.length).toEqual(2);
      expect(page1.page.totalElements).toBe(3);

      const page2 = await ctrl.findFiles({
        query: { bucket: app.images.name, size: 2, page: 1 },
      });
      expect(page2.content.length).toEqual(1);
      expect(page2.page.totalElements).toBe(3);
    });

    it("should return files sorted by creation date descending by default", async () => {
      const { app, ctrl } = await setup();
      const file1 = await app.images.upload(createFile("first.txt"));
      const file2 = await app.images.upload(createFile("second.txt"));
      const file3 = await app.images.upload(createFile("third.txt"));

      const files = await ctrl.findFiles({
        query: { bucket: app.images.name },
      });

      expect(files.content[0].blobId).toBe(file3);
      expect(files.content[1].blobId).toBe(file2);
      expect(files.content[2].blobId).toBe(file1);
    });
  });

  describe("uploadFile", () => {
    it("should upload file to default bucket", async () => {
      const { ctrl } = await setup();
      const file = createFile("Hello, World!", {
        name: "test.txt",
        type: "text/plain",
      });

      const result = await ctrl.uploadFile({
        body: { file },
        query: {},
      });

      expect(result.name).toBe("test.txt");
      expect(result.mimeType).toBe("text/plain");
      expect(result.size).toBeGreaterThan(0);
      expect(result.blobId).toBeDefined();
    });

    it("should upload file to specific bucket", async () => {
      const { app, ctrl } = await setup();
      const file = createFile("Document content", {
        name: "doc.pdf",
        type: "application/pdf",
      });

      const result = await ctrl.uploadFile({
        body: { file },
        query: { bucket: app.documents.name },
      });

      expect(result.bucket).toBe(app.documents.name);
      expect(result.name).toBe("doc.pdf");
    });

    it("should upload file with expiration date", async () => {
      const { ctrl, dtp } = await setup();
      const file = createFile("Temporary file", { name: "temp.txt" });
      const expirationDate = dtp.now().add(1, "hour").toISOString();

      const result = await ctrl.uploadFile({
        body: { file },
        query: { expirationDate },
      });

      expect(result.expirationDate).toBe(expirationDate);
    });

    it("should capture user information when provided", async () => {
      const { ctrl, service } = await setup();
      const file = createFile("User file", { name: "user.txt" });

      const result = await service.uploadFile(file, {
        user: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          realm: "test-realm",
          name: "Test User",
        },
      });

      expect(result.creator).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(result.creatorRealm).toBe("test-realm");
      expect(result.creatorName).toBe("Test User");
    });
  });

  describe("streamFile", () => {
    it("should stream uploaded file", async () => {
      const { ctrl } = await setup();
      const originalContent = "Hello, World!";
      const file = createFile(originalContent, {
        name: "test.txt",
        type: "text/plain",
      });

      const uploaded = await ctrl.uploadFile({
        body: { file },
        query: {},
      });

      const streamed = await ctrl.streamFile({ params: { id: uploaded.id } });

      expect(streamed.name).toBe("test.txt");
      expect(streamed.type).toBe("text/plain");
      expect(await streamed.text()).toBe(originalContent);
    });

    it("should throw NotFoundError for non-existent file", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.streamFile({
          params: { id: "00000000-0000-0000-0000-000000000000" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("deleteFile", () => {
    it("should delete existing file", async () => {
      const { ctrl } = await setup();
      const file = createFile("To be deleted", { name: "delete-me.txt" });

      const uploaded = await ctrl.uploadFile({
        body: { file },
        query: {},
      });

      const result = await ctrl.deleteFile({
        params: { id: uploaded.id },
      });

      expect(result.ok).toBe(true);
      expect(result.id).toBe(uploaded.id);

      // Verify file is actually deleted
      await expect(
        ctrl.streamFile({ params: { id: uploaded.id } }),
      ).rejects.toThrow();
    });

    it("should throw NotFoundError when deleting non-existent file", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.deleteFile({
          params: { id: "00000000-0000-0000-0000-000000000000" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete file lifecycle", async () => {
      const { ctrl } = await setup();

      // Upload
      const file = createFile("Lifecycle test", { name: "lifecycle.txt" });
      const uploaded = await ctrl.uploadFile({
        body: { file },
        query: {},
      });

      // List
      const listResult = await ctrl.findFiles({ query: {} });
      expect(listResult.content).toContainEqual(
        expect.objectContaining({ id: uploaded.id }),
      );

      // Stream
      const streamed = await ctrl.streamFile({
        params: { id: uploaded.id },
      });
      expect(await streamed.text()).toBe("Lifecycle test");

      // Delete
      await ctrl.deleteFile({ params: { id: uploaded.id } });

      // Verify deletion
      const finalList = await ctrl.findFiles({ query: {} });
      expect(
        finalList.content.find((f) => f.id === uploaded.id),
      ).toBeUndefined();
    });

    it("should handle multiple files with different properties", async () => {
      const { ctrl, dtp, service } = await setup();

      // Upload various files
      await ctrl.uploadFile({
        body: { file: createFile("File 1", { name: "file1.txt" }) },
        query: {},
      });

      await service.uploadFile(createFile("File 2", { name: "file2.txt" }), {
        tags: ["important"],
      });

      await ctrl.uploadFile({
        body: { file: createFile("File 3", { name: "file3.txt" }) },
        query: { expirationDate: dtp.now().add(1, "hour").toISOString() },
      });

      const allFiles = await ctrl.findFiles({ query: {} });
      expect(allFiles.content.length).toBe(3);

      const taggedFiles = await ctrl.findFiles({
        query: { tags: ["important"] },
      });
      expect(taggedFiles.content.length).toBe(1);
    });
  });
});

import { Alepha } from "alepha";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import type { UserAccountToken } from "alepha/security";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { FileController, FileService } from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
  // Admin identity bypasses `FileAccessProvider.assertReadable`'s
  // creator-only default; without this every streamFile test would
  // require the admin to also be the uploader.
  ownership: false,
};

const asAdmin = { user: adminUser };

describe("FileController", () => {
  class App {
    images = $bucket({});
    documents = $bucket({ name: "documents" });
  }

  let createFile: (
    textOrOpts: string | { text: string; name?: string; type?: string },
    opts?: { name?: string; type?: string },
  ) => any;

  const setup = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    const ctrl = alepha.inject(FileController);
    const service = alepha.inject(FileService);
    const dtp = alepha.inject(DateTimeProvider);
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
    return { alepha, app, ctrl, service, dtp, fs };
  };

  describe("findFiles", () => {
    it("should return files from specific bucket", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("test"));
      const files = await ctrl.findFiles(
        { query: { bucket: app.images.name } },
        asAdmin,
      );
      expect(files.content.length).toEqual(1);
    });

    it("should return empty list when no files exist", async () => {
      const { ctrl } = await setup();
      const files = await ctrl.findFiles({}, asAdmin);
      expect(files.content).toEqual([]);
      expect(files.page.totalElements).toBe(0);
    });

    it("should return files from all buckets when no bucket filter", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("image.png"));
      await app.documents.upload(createFile("doc.pdf"));

      const files = await ctrl.findFiles({ query: {} }, asAdmin);
      expect(files.content.length).toEqual(2);
    });

    it("should filter files by bucket", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("image.png"));
      await app.documents.upload(createFile("doc.pdf"));

      const imagesFiles = await ctrl.findFiles(
        { query: { bucket: app.images.name } },
        asAdmin,
      );
      expect(imagesFiles.content.length).toEqual(1);
      expect(imagesFiles.content[0].bucket).toBe(app.images.name);

      const docsFiles = await ctrl.findFiles(
        { query: { bucket: app.documents.name } },
        asAdmin,
      );
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

      const importantFiles = await ctrl.findFiles.run(
        { query: { tags: ["important"] } },
        asAdmin,
      );
      expect(importantFiles.content.length).toEqual(2);
    });

    it("should support pagination", async () => {
      const { app, ctrl } = await setup();
      await app.images.upload(createFile("file1.txt"));
      await app.images.upload(createFile("file2.txt"));
      await app.images.upload(createFile("file3.txt"));

      const page1 = await ctrl.findFiles(
        { query: { bucket: app.images.name, size: 2, page: 0 } },
        asAdmin,
      );

      expect(page1.content.length).toEqual(2);
      expect(page1.page.totalElements).toBe(3);

      const page2 = await ctrl.findFiles(
        { query: { bucket: app.images.name, size: 2, page: 1 } },
        asAdmin,
      );
      expect(page2.content.length).toEqual(1);
      expect(page2.page.totalElements).toBe(3);
    });

    it("should return files sorted by creation date descending by default", async () => {
      const { app, ctrl } = await setup();
      const file1 = await app.images.upload(createFile("first.txt"));
      const file2 = await app.images.upload(createFile("second.txt"));
      const file3 = await app.images.upload(createFile("third.txt"));

      const files = await ctrl.findFiles(
        { query: { bucket: app.images.name } },
        asAdmin,
      );

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

      const result = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      expect(result.name).toBe("test.txt");
      expect(result.mimeType).toBe("text/plain");
      expect(result.size).toBeGreaterThan(0);
      expect(result.blobId).toBeDefined();
    });

    it("should calculate and store file checksum", async () => {
      const { ctrl } = await setup();
      const file = createFile("Hello, World!", {
        name: "test.txt",
        type: "text/plain",
      });

      const result = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      expect(result.checksum).toBeDefined();
      expect(result.checksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it("should upload file to specific bucket", async () => {
      const { app, ctrl } = await setup();
      const file = createFile("Document content", {
        name: "doc.pdf",
        type: "application/pdf",
      });

      const result = await ctrl.uploadFile(
        { body: { file }, query: { bucket: app.documents.name } },
        asAdmin,
      );

      expect(result.bucket).toBe(app.documents.name);
      expect(result.name).toBe("doc.pdf");
    });

    it("should upload file with expiration date", async () => {
      const { ctrl, dtp } = await setup();
      const file = createFile("Temporary file", { name: "temp.txt" });
      const expirationDate = dtp.now().add(1, "hour").toISOString();

      const result = await ctrl.uploadFile(
        { body: { file }, query: { expirationDate } },
        asAdmin,
      );

      expect(result.expirationDate).toEqual(expirationDate);
    });

    it("should capture user information when provided", async () => {
      const { service } = await setup();
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

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const streamed = await ctrl.streamFile(
        { params: { id: uploaded.id } },
        asAdmin,
      );

      expect(streamed.name).toBe("test.txt");
      expect(streamed.type).toBe("text/plain");
      expect(await streamed.text()).toBe(originalContent);
    });

    it("should throw NotFoundError for non-existent file", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.streamFile(
          { params: { id: "00000000-0000-0000-0000-000000000000" } },
          asAdmin,
        ),
      ).rejects.toThrow();
    });
  });

  describe("deleteFile", () => {
    it("should delete existing file", async () => {
      const { ctrl } = await setup();
      const file = createFile("To be deleted", { name: "delete-me.txt" });

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const result = await ctrl.deleteFile(
        { params: { id: uploaded.id } },
        asAdmin,
      );

      expect(result.ok).toBe(true);
      expect(result.id).toBe(uploaded.id);

      // Verify file is actually deleted
      await expect(
        ctrl.streamFile({ params: { id: uploaded.id } }, asAdmin),
      ).rejects.toThrow();
    });

    it("should throw NotFoundError when deleting non-existent file", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.deleteFile(
          { params: { id: "00000000-0000-0000-0000-000000000000" } },
          asAdmin,
        ),
      ).rejects.toThrow();
    });
  });

  describe("updateFile", () => {
    it("should update file name", async () => {
      const { ctrl } = await setup();
      const file = createFile("test content", { name: "original.txt" });

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const updated = await ctrl.updateFile(
        { params: { id: uploaded.id }, body: { name: "renamed.txt" } },
        asAdmin,
      );

      expect(updated.name).toBe("renamed.txt");
      expect(updated.id).toBe(uploaded.id);
    });

    it("should update file tags", async () => {
      const { ctrl } = await setup();
      const file = createFile("test content", { name: "test.txt" });

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const updated = await ctrl.updateFile(
        { params: { id: uploaded.id }, body: { tags: ["important", "work"] } },
        asAdmin,
      );

      expect(updated.tags).toEqual(["important", "work"]);
    });

    it("should update file expiration date", async () => {
      const { ctrl, dtp } = await setup();
      const file = createFile("test content", { name: "test.txt" });

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const newExpiration = dtp.now().add(2, "days").toISOString();

      const updated = await ctrl.updateFile(
        {
          params: { id: uploaded.id },
          body: { expirationDate: newExpiration },
        },
        asAdmin,
      );

      expect(updated.expirationDate).toBe(newExpiration);
    });

    it("should update multiple fields at once", async () => {
      const { ctrl, dtp } = await setup();
      const file = createFile("test content", { name: "original.txt" });

      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      const newExpiration = dtp.now().add(3, "days").toISOString();

      const updated = await ctrl.updateFile(
        {
          params: { id: uploaded.id },
          body: {
            name: "updated.txt",
            tags: ["tag1", "tag2"],
            expirationDate: newExpiration,
          },
        },
        asAdmin,
      );

      expect(updated.name).toBe("updated.txt");
      expect(updated.tags).toEqual(["tag1", "tag2"]);
      expect(updated.expirationDate).toBe(newExpiration);
    });

    it("should throw error when updating non-existent file", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.updateFile(
          {
            params: { id: "00000000-0000-0000-0000-000000000000" },
            body: { name: "new-name.txt" },
          },
          asAdmin,
        ),
      ).rejects.toThrow();
    });
  });

  describe("enhanced search filtering", () => {
    it("should filter by file name (partial match)", async () => {
      const { service, ctrl } = await setup();
      await service.uploadFile(
        createFile("content", { name: "report-2024.pdf" }),
      );
      await service.uploadFile(
        createFile("content", { name: "invoice-march.pdf" }),
      );
      await service.uploadFile(
        createFile("content", { name: "report-2025.pdf" }),
      );

      const results = await ctrl.findFiles(
        { query: { name: "report" } },
        asAdmin,
      );
      expect(results.content.length).toBe(2);
      expect(results.content.every((f) => f.name.includes("report"))).toBe(
        true,
      );
    });

    it("should filter by MIME type", async () => {
      const { service, ctrl } = await setup();
      await service.uploadFile(
        createFile("content", { name: "file1.pdf", type: "application/pdf" }),
      );
      await service.uploadFile(
        createFile("content", { name: "file2.txt", type: "text/plain" }),
      );
      await service.uploadFile(
        createFile("content", { name: "file3.pdf", type: "application/pdf" }),
      );

      const results = await ctrl.findFiles(
        { query: { mimeType: "application/pdf" } },
        asAdmin,
      );
      expect(results.content.length).toBe(2);
      expect(
        results.content.every((f) => f.mimeType === "application/pdf"),
      ).toBe(true);
    });

    it("should filter by creator", async () => {
      const { service, ctrl } = await setup();
      const user1Id = "123e4567-e89b-12d3-a456-426614174000";
      const user2Id = "223e4567-e89b-12d3-a456-426614174000";

      await service.uploadFile(createFile("content", { name: "file1.txt" }), {
        user: { id: user1Id, realm: "test", name: "User 1" },
      });
      await service.uploadFile(createFile("content", { name: "file2.txt" }), {
        user: { id: user2Id, realm: "test", name: "User 2" },
      });
      await service.uploadFile(createFile("content", { name: "file3.txt" }), {
        user: { id: user1Id, realm: "test", name: "User 1" },
      });

      const results = await ctrl.findFiles(
        { query: { creator: user1Id } },
        asAdmin,
      );
      expect(results.content.length).toBe(2);
      expect(results.content.every((f) => f.creator === user1Id)).toBe(true);
    });

    it("should filter by date range", { retry: 3 }, async () => {
      const { service, ctrl, dtp } = await setup();

      const startTime = dtp.nowISOString();

      // ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 1));

      await service.uploadFile(createFile("content", { name: "file1.txt" }));
      await service.uploadFile(createFile("content", { name: "file2.txt" }));
      await service.uploadFile(createFile("content", { name: "file3.txt" }));

      const results = await ctrl.findFiles(
        { query: { createdAfter: startTime } },
        asAdmin,
      );
      expect(results.content.length).toBe(3);

      const futureTime = dtp.now().add(1, "hour").toISOString();
      const results2 = await ctrl.findFiles(
        { query: { createdBefore: futureTime } },
        asAdmin,
      );
      expect(results2.content.length).toBe(3);
    });

    it("should combine multiple filters", async () => {
      const { service, ctrl } = await setup();
      const userId = "123e4567-e89b-12d3-a456-426614174000";

      await service.uploadFile(
        createFile("content", { name: "report.pdf", type: "application/pdf" }),
        {
          user: { id: userId, realm: "test", name: "User" },
          tags: ["important"],
        },
      );
      await service.uploadFile(
        createFile("content", { name: "invoice.pdf", type: "application/pdf" }),
        { tags: ["important"] },
      );
      await service.uploadFile(
        createFile("content", { name: "report.txt", type: "text/plain" }),
        { user: { id: userId, realm: "test", name: "User" } },
      );

      const results = await ctrl.findFiles(
        {
          query: {
            name: "report",
            mimeType: "application/pdf",
            creator: userId,
            tags: ["important"],
          },
        },
        asAdmin,
      );

      expect(results.content.length).toBe(1);
      expect(results.content[0].name).toBe("report.pdf");
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete file lifecycle", async () => {
      const { ctrl } = await setup();

      // Upload
      const file = createFile("Lifecycle test", { name: "lifecycle.txt" });
      const uploaded = await ctrl.uploadFile(
        { body: { file }, query: {} },
        asAdmin,
      );

      // List
      const listResult = await ctrl.findFiles({ query: {} }, asAdmin);
      expect(listResult.content).toContainEqual(
        expect.objectContaining({ id: uploaded.id }),
      );

      // Stream
      const streamed = await ctrl.streamFile(
        { params: { id: uploaded.id } },
        asAdmin,
      );
      expect(await streamed.text()).toBe("Lifecycle test");

      // Delete
      await ctrl.deleteFile({ params: { id: uploaded.id } }, asAdmin);

      // Verify deletion
      const finalList = await ctrl.findFiles({ query: {} }, asAdmin);
      expect(
        finalList.content.find((f) => f.id === uploaded.id),
      ).toBeUndefined();
    });

    it("should handle multiple files with different properties", async () => {
      const { ctrl, dtp, service } = await setup();

      await ctrl.uploadFile(
        {
          body: { file: createFile("File 1", { name: "file1.txt" }) },
          query: {},
        },
        asAdmin,
      );

      await service.uploadFile(createFile("File 2", { name: "file2.txt" }), {
        tags: ["important"],
      });

      await ctrl.uploadFile(
        {
          body: { file: createFile("File 3", { name: "file3.txt" }) },
          query: { expirationDate: dtp.now().add(1, "hour").toISOString() },
        },
        asAdmin,
      );

      const allFiles = await ctrl.findFiles({ query: {} }, asAdmin);
      expect(allFiles.content.length).toBe(3);

      const taggedFiles = await ctrl.findFiles(
        { query: { tags: ["important"] } },
        asAdmin,
      );
      expect(taggedFiles.content.length).toBe(1);
    });
  });
});

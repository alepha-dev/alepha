import { Alepha } from "alepha";
import { describe, test } from "vitest";
import { AlephaBucket } from "../../src/bucket";
import { FileStorageProvider } from "../../src/bucket/providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../../src/bucket/providers/MemoryFileStorageProvider.ts";

describe("FileStorageProvider", () => {
  test("create default provider", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaBucket);
    const fileStorageProvider = alepha.inject(FileStorageProvider);
    expect(fileStorageProvider).toBeInstanceOf(MemoryFileStorageProvider);
  });
});

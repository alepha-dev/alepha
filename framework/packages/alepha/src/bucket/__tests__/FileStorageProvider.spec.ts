import { Alepha } from "alepha";
import { describe, test } from "vitest";

import { AlephaBucket } from "../index.ts";
import { FileStorageProvider } from "../providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";

describe("FileStorageProvider", () => {
  test("create default provider", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaBucket);
    const fileStorageProvider = alepha.inject(FileStorageProvider);
    expect(fileStorageProvider).toBeInstanceOf(MemoryFileStorageProvider);
  });
});

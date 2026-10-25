import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, test } from "vitest";

import {
  testCustomFileId,
  testDeleteFile,
  testDeleteNonExistentFile,
  testDownloadAndMetadata,
  testUploadedNameAndTypeSurvive,
  testEmptyFiles,
  testFileExistence,
  testFileStream,
  testListFiles,
  testNonExistentFile,
  testNonExistentFileError,
  testUploadAndExistence,
  testUploadIntoBuckets,
} from "../__tests__/shared.ts";
import {
  AlephaBucket,
  FileStorageProvider,
  LocalFileStorageProvider,
} from "../index.ts";

const alepha = Alepha.create()
  .with({
    provide: FileStorageProvider,
    use: LocalFileStorageProvider,
  })
  .with(AlephaBucket);

const provider = alepha.inject(LocalFileStorageProvider);

describe("LocalFileStorageProvider", () => {
  test("should upload a file and return a fileId", async () => {
    await testUploadAndExistence(provider);
  });

  test("should download a file and restore its metadata", async () => {
    await testDownloadAndMetadata(provider);
  });

  test("should keep the uploaded name and type", async () => {
    await testUploadedNameAndTypeSurvive(provider);
  });

  test("exists() should return false for a non-existent file", async () => {
    await testNonExistentFile(provider);
  });

  test("exists() should return true for an existing file", async () => {
    await testFileExistence(provider);
  });

  test("should delete a file", async () => {
    await testDeleteFile(provider);
  });

  test("delete() should throw for a non-existent file", async () => {
    await testDeleteNonExistentFile(provider);
  });

  test("download() should throw FileNotFoundError for a non-existent file", async () => {
    await testNonExistentFileError(provider);
  });

  test("should handle uploading to different buckets", async () => {
    await testUploadIntoBuckets(provider);
  });

  test("should handle empty files correctly", async () => {
    await testEmptyFiles(provider);
  });

  test("should be able to upload with a specific fileId", async () => {
    await testCustomFileId(provider);
  });

  test("should be able to upload, stream with metadata", async () => {
    await testFileStream(provider);
  });

  test("should list files in a bucket", async () => {
    await testListFiles(provider);
  });
});

/**
 * Exposes the sidecar plumbing, so a test can put the bucket into the state a
 * blob uploaded before sidecars existed is in.
 */
class TestLocalFileStorageProvider extends LocalFileStorageProvider {
  public testRemoveMeta = this.removeMeta.bind(this);
}

describe("LocalFileStorageProvider sidecars", () => {
  const boot = () => {
    const app = Alepha.create()
      .with({
        provide: FileStorageProvider,
        use: TestLocalFileStorageProvider,
      })
      .with(AlephaBucket);
    return {
      provider: app.inject(TestLocalFileStorageProvider),
      fs: app.inject(FileSystemProvider),
    };
  };

  // Blobs written before this provider kept a sidecar have none, and they
  // still have to download. The old behaviour is the fallback, not an error.
  test("should sniff the type from the id when there is no sidecar", async () => {
    const { provider, fs } = boot();
    const fileId = await provider.upload(
      "test-images",
      fs.createFile({ text: "x", name: "photo.png", type: "image/png" }),
    );

    await provider.testRemoveMeta("test-images", fileId);

    const downloaded = await provider.download("test-images", fileId);
    expect(downloaded.name).toBe(fileId);
    expect(downloaded.type).toBe("image/png");
  });

  // The suffix names this provider's own metadata. Accepting it would let one
  // upload shadow another blob's name and type, and hide itself from `list`.
  test("should refuse a file id ending in the reserved suffix", async () => {
    const { provider, fs } = boot();

    await expect(
      provider.upload(
        "test-images",
        fs.createFile({ text: "x", name: "x.txt" }),
        "sneaky.meta.json",
      ),
    ).rejects.toThrow(AlephaError);
  });
});

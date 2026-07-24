import { Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, test } from "vitest";
import {
  AlephaBucket,
  FileStorageProvider,
  S3FileStorageProvider,
} from "../index.ts";
import {
  TEST_IMAGES_BUCKET,
  TestApp,
  testCustomFileId,
  testDeleteFile,
  testDeleteNonExistentFile,
  testDownloadAndMetadata,
  testEmptyFiles,
  testFileExistence,
  testFileStream,
  testNonExistentFile,
  testNonExistentFileError,
  testUploadAndExistence,
  testUploadIntoBuckets,
} from "./shared.ts";

const alepha = Alepha.create()
  .with({ provide: FileStorageProvider, use: S3FileStorageProvider })
  .with(AlephaBucket)
  .with(TestApp);

const provider = alepha.inject(S3FileStorageProvider);

describe("NodeS3BucketProvider", () => {
  test("should upload a file and return a fileId", async () => {
    await testUploadAndExistence(provider);
  });

  test("should download a file and restore its metadata", async () => {
    await testDownloadAndMetadata(provider);
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
    const fs = Alepha.create().inject(FileSystemProvider);
    const a = await provider.upload(
      TEST_IMAGES_BUCKET,
      fs.createFile({ text: "a", name: "a.txt" }),
    );
    const b = await provider.upload(
      TEST_IMAGES_BUCKET,
      fs.createFile({ text: "b", name: "b.txt" }),
    );

    // Shared bucket may hold files from other tests, so assert a superset.
    const ids = await provider.list(TEST_IMAGES_BUCKET);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });
});

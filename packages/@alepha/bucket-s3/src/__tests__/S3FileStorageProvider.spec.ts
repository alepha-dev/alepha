import { Alepha } from "alepha";
import { describe, test } from "vitest";
import {
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
} from "../../../../alepha/src/bucket/__tests__/shared.ts";
import { AlephaBucketS3, S3FileStorageProvider } from "../index.ts";

const alepha = Alepha.create().with(AlephaBucketS3).with(TestApp);

const provider = alepha.inject(S3FileStorageProvider);

describe("S3FileStorageProvider", () => {
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

  test("delete() should not throw for a non-existent file", async () => {
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
});

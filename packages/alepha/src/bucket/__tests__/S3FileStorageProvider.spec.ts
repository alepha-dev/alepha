import { Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  AlephaBucket,
  FileStorageProvider,
  S3FileStorageProvider,
} from "../index.ts";
import {
  emptyBuckets,
  TEST_DOCUMENTS_BUCKET,
  TEST_IMAGES_BUCKET,
  testCustomFileId,
  testDeleteFile,
  testDeleteNonExistentFile,
  testDownloadAndMetadata,
  testUploadedNameAndTypeSurvive,
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
  .with(AlephaBucket);

const provider = alepha.inject(S3FileStorageProvider);

describe("S3FileStorageProvider", () => {
  // The provider no longer creates buckets: containers are key prefixes
  // inside one bucket that you provision. Create it here so the suite is
  // self-contained (s3mock's `initialBuckets` env is not honoured by the
  // image we pin).
  beforeAll(async () => {
    await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME}`, {
      method: "PUT",
    });
  });

  // The store is a shared tmpfs that outlives the run — leave it the way a
  // fresh container starts. Containers are disjoint per spec file, so this
  // cannot race the streamed-upload suite.
  afterAll(async () => {
    await emptyBuckets(provider, [TEST_IMAGES_BUCKET, TEST_DOCUMENTS_BUCKET]);
  });

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

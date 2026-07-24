import { Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { expect } from "vitest";
import {
  $bucket,
  FileNotFoundError,
  type FileStorageProvider,
} from "../index.ts";

export const TEST_IMAGES_BUCKET = "test-images";
export const TEST_DOCUMENTS_BUCKET = "test-documents";
export class TestApp {
  images = $bucket({ name: TEST_IMAGES_BUCKET });
  documents = $bucket({ name: TEST_DOCUMENTS_BUCKET });
}

const BUCKET_NAME = TEST_IMAGES_BUCKET;

// Helper to create file system instance
const getFileSystem = () => Alepha.create().inject(FileSystemProvider);

export const testUploadAndExistence = async (
  provider: FileStorageProvider,
): Promise<string> => {
  const content = "This is a test image.";
  const file = getFileSystem().createFile({
    text: content,
    name: "test.jpg",
    type: "image/jpeg",
  });

  const fileId = await provider.upload(BUCKET_NAME, file);

  expect(fileId).toBeTypeOf("string");
  expect(fileId.length).toBeGreaterThan(0);

  // Verify the file physically exists
  const fileExists = await provider.exists(BUCKET_NAME, fileId);
  expect(fileExists).toBe(true);

  return fileId;
};

export const testDownloadAndMetadata = async (
  provider: FileStorageProvider,
): Promise<string> => {
  const content = "<h1>Hello Alepha</h1>";
  const originalFile = getFileSystem().createFile({
    text: content,
    name: "index.html",
    type: "text/html",
  });

  const fileId = await provider.upload(BUCKET_NAME, originalFile);
  const downloadedFile = await provider.download(BUCKET_NAME, fileId);

  // Check metadata
  expect(downloadedFile.type).toBe("text/html");
  expect(downloadedFile.size).toBe(content.length);

  // Check content
  const downloadedContent = await downloadedFile.text();
  expect(downloadedContent).toBe(content);

  return fileId;
};

export const testFileExistence = async (
  provider: FileStorageProvider,
): Promise<string> => {
  const file = getFileSystem().createFile({
    text: "exists",
    name: "exists.txt",
  });
  const fileId = await provider.upload(BUCKET_NAME, file);
  const fileExists = await provider.exists(BUCKET_NAME, fileId);
  expect(fileExists).toBe(true);
  return fileId;
};

export const testNonExistentFile = async (provider: FileStorageProvider) => {
  const fileExists = await provider.exists(BUCKET_NAME, "non-existent-file-id");
  expect(fileExists).toBe(false);
};

export const testDeleteNonExistentFile = async (
  provider: FileStorageProvider,
) => {
  const file = getFileSystem().createFile({
    text: "exists",
    name: "exists.txt",
  });
  const fileId = await provider.upload(BUCKET_NAME, file);
  const fileExists = await provider.exists(BUCKET_NAME, fileId);
  expect(fileExists).toBe(true);
  await provider.delete(BUCKET_NAME, fileId);
  const fileExists2 = await provider.exists(BUCKET_NAME, fileId);
  expect(fileExists2).toBe(false);

  // Deleting an id that does not exist must throw on EVERY provider — a
  // backend that silently succeeds hides broken cleanup logic until the app
  // switches provider.
  await expect(
    provider.delete(BUCKET_NAME, "does-not-exist.txt"),
  ).rejects.toThrow();
};

export const testDeleteFile = async (provider: FileStorageProvider) => {
  const file = getFileSystem().createFile({
    text: "to be deleted",
    name: "delete_me.txt",
  });
  const fileId = await provider.upload(BUCKET_NAME, file);

  // Verify it exists before deleting
  expect(await provider.exists(BUCKET_NAME, fileId)).toBe(true);

  await provider.delete(BUCKET_NAME, fileId);

  // Verify it no longer exists after deletion
  expect(await provider.exists(BUCKET_NAME, fileId)).toBe(false);
};

export const testNonExistentFileError = async (
  provider: FileStorageProvider,
) => {
  await expect(
    provider.download(BUCKET_NAME, "i-do-not-exist"),
  ).rejects.toThrow(FileNotFoundError);
};

export const testUploadIntoBuckets = async (
  provider: FileStorageProvider,
): Promise<{ docId: string; imgId: string }> => {
  const fs = getFileSystem();
  const docFile = fs.createFile({ text: "report", name: "report.pdf" });
  const imgFile = fs.createFile({ text: "logo", name: "logo.png" });

  const docId = await provider.upload(TEST_DOCUMENTS_BUCKET, docFile);
  const imgId = await provider.upload(TEST_IMAGES_BUCKET, imgFile);

  expect(await provider.exists(TEST_DOCUMENTS_BUCKET, docId)).toBe(true);
  expect(await provider.exists(TEST_IMAGES_BUCKET, imgId)).toBe(true);

  // Ensure files are in separate directories and not mixed up
  expect(await provider.exists(TEST_DOCUMENTS_BUCKET, imgId)).toBe(false);
  expect(await provider.exists(TEST_IMAGES_BUCKET, docId)).toBe(false);

  return { docId, imgId };
};

export const testFileStream = async (
  provider: FileStorageProvider,
): Promise<string> => {
  const content = "Streaming content test.";
  const file = getFileSystem().createFile({
    text: content,
    name: "stream.txt",
    type: "text/plain",
  });

  const fileId = await provider.upload(BUCKET_NAME, file);
  const stream = await provider.download(BUCKET_NAME, fileId);

  expect(stream.type).toBe("text/plain");

  const streamContent = await stream.text();
  expect(streamContent).toBe(content);

  return fileId;
};

export const testEmptyFiles = async (provider: FileStorageProvider) => {
  const emptyFile = getFileSystem().createFile({
    text: "",
    name: "empty.txt",
    type: "text/plain",
  });

  const fileId = await provider.upload(BUCKET_NAME, emptyFile);
  const downloadedFile = await provider.download(BUCKET_NAME, fileId);

  expect(downloadedFile.type).toBe("text/plain");
  expect(downloadedFile.size).toBe(0);
  expect(await downloadedFile.text()).toBe("");
};

export const testListFiles = async (provider: FileStorageProvider) => {
  const fs = getFileSystem();

  // Unknown bucket lists to nothing rather than throwing.
  expect(await provider.list("test-unknown-bucket")).toEqual([]);

  // Use a declared bucket so directory-backed providers have it provisioned.
  const a = await provider.upload(
    TEST_DOCUMENTS_BUCKET,
    fs.createFile({ text: "a", name: "a.txt" }),
  );
  const b = await provider.upload(
    TEST_DOCUMENTS_BUCKET,
    fs.createFile({ text: "b", name: "b.txt" }),
  );

  const ids = await provider.list(TEST_DOCUMENTS_BUCKET);
  expect(ids).toContain(a);
  expect(ids).toContain(b);

  // Listing is scoped to the bucket — ids do not leak across buckets.
  expect(await provider.list(TEST_IMAGES_BUCKET)).not.toContain(a);

  // Deleted files drop out of the listing.
  await provider.delete(TEST_DOCUMENTS_BUCKET, a);
  const after = await provider.list(TEST_DOCUMENTS_BUCKET);
  expect(after).not.toContain(a);
  expect(after).toContain(b);
};

export const testCustomFileId = async (provider: FileStorageProvider) => {
  const file = getFileSystem().createFile({
    text: "custom id",
    name: "custom.txt",
  });
  const customFileId = "custom-file-id";

  const uploadedFileId = await provider.upload(BUCKET_NAME, file, customFileId);

  expect(uploadedFileId).toBe(customFileId);

  const fileExists = await provider.exists(BUCKET_NAME, customFileId);
  expect(fileExists).toBe(true);
};

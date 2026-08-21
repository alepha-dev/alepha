import { Alepha, AlephaError, type FileLike } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { expect } from "vitest";

import {
  FileNotFoundError,
  type FileStorageProvider,
  InvalidFileError,
} from "../index.ts";

/**
 * Drains every object under the given containers.
 *
 * The s3mock store from `compose.yml` is shared across runs and bounded (a
 * 4 GB tmpfs): the streamed-upload suite alone leaves ~70 MB of UUID-named
 * objects per run, so without teardown the tmpfs fills after a few dozen runs
 * and every bucket test fails until the container restarts. Suites that write
 * to s3mock call this from `afterAll` — draining by container prefix also
 * removes whatever earlier, less tidy runs left behind.
 */
export const emptyBuckets = async (
  provider: FileStorageProvider,
  bucketNames: string[],
): Promise<void> => {
  for (const bucketName of bucketNames) {
    // `list()` returns one flat page (~1000 keys), so keep going until the
    // store reports the container empty. Bounded, so a delete that silently
    // fails surfaces as an error instead of an infinite loop.
    for (let pass = 0; ; pass++) {
      const ids = await provider.list(bucketName);
      if (ids.length === 0) {
        break;
      }
      if (pass >= 100) {
        throw new AlephaError(
          `Container '${bucketName}' still holds ${ids.length} objects after ${pass} delete passes`,
        );
      }
      await provider.deleteMany(bucketName, ids);
    }
  }
};

// Container names are just key prefixes now — no primitive declares them and
// no provider pre-creates them, so these are plain strings.
export const TEST_IMAGES_BUCKET = "test-images";
export const TEST_DOCUMENTS_BUCKET = "test-documents";

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

/**
 * A refusal raised while the bytes are in flight keeps its HTTP status.
 *
 * The size cap on a streamed upload can only fire mid-transfer — nobody knows
 * the length up front — so it surfaces out of `upload()` rather than before it.
 * A provider that wraps whatever its transport threw turns that refusal into an
 * anonymous 500, and the caller learns nothing. Shared because the two
 * providers answered differently: R2 relayed the error, S3 swallowed it.
 */
export const testKeepsTheStatusOfAStreamRefusal = async (
  provider: FileStorageProvider,
  bucket: string = BUCKET_NAME,
) => {
  const refusal = new InvalidFileError("File exceeds the maximum size of 1 MB");
  const file: FileLike = {
    name: "big.bin",
    type: "application/octet-stream",
    // 0 is what a body reports until it has been read — the streamed path.
    size: 0,
    lastModified: 0,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(refusal);
        },
      }) as never,
    arrayBuffer: async () => {
      throw new Error("a streamed upload is not buffered");
    },
    text: async () => {
      throw new Error("not readable as text");
    },
  };

  await expect(provider.upload(bucket, file)).rejects.toThrow(InvalidFileError);
};

import { createFile } from "@alepha/file";
import { expect } from "vitest";
import { $bucket, FileNotFoundError, type FileStorageProvider } from "../src";

export class TestApp {
	images = $bucket({ name: "images" });
	documents = $bucket({ name: "documents" });
}

const BUCKET_NAME = "images";

export const testUploadAndExistence = async (provider: FileStorageProvider) => {
	const content = "This is a test image.";
	const file = createFile(content, { name: "test.jpg", type: "image/jpeg" });

	const fileId = await provider.upload(BUCKET_NAME, file);

	expect(fileId).toBeTypeOf("string");
	expect(fileId.length).toBeGreaterThan(0);

	// Verify the file physically exists
	const fileExists = await provider.exists(BUCKET_NAME, fileId);
	expect(fileExists).toBe(true);
};

export const testDownloadAndMetadata = async (
	provider: FileStorageProvider,
) => {
	const content = "<h1>Hello Alepha</h1>";
	const originalFile = createFile(content, {
		name: "index.html",
		type: "text/html",
	});

	const fileId = await provider.upload(BUCKET_NAME, originalFile);
	const downloadedFile = await provider.download(BUCKET_NAME, fileId);

	// Check metadata
	expect(downloadedFile.name).toBe("index.html");
	expect(downloadedFile.type).toBe("text/html");
	expect(downloadedFile.size).toBe(content.length);

	// Check content
	const downloadedContent = await downloadedFile.text();
	expect(downloadedContent).toBe(content);
};

export const testFileExistence = async (provider: FileStorageProvider) => {
	const file = createFile("exists", { name: "exists.txt" });
	const fileId = await provider.upload(BUCKET_NAME, file);
	const fileExists = await provider.exists(BUCKET_NAME, fileId);
	expect(fileExists).toBe(true);
};

export const testNonExistentFile = async (provider: FileStorageProvider) => {
	const fileExists = await provider.exists(BUCKET_NAME, "non-existent-file-id");
	expect(fileExists).toBe(false);
};

export const testDeleteNonExistentFile = async (
	provider: FileStorageProvider,
) => {
	const file = createFile("exists", { name: "exists.txt" });
	const fileId = await provider.upload(BUCKET_NAME, file);
	const fileExists = await provider.exists(BUCKET_NAME, fileId);
	expect(fileExists).toBe(true);
	await provider.delete(BUCKET_NAME, fileId);
	const fileExists2 = await provider.exists(BUCKET_NAME, fileId);
	expect(fileExists2).toBe(false);
};

export const testDeleteFile = async (provider: FileStorageProvider) => {
	const file = createFile("to be deleted", { name: "delete_me.txt" });
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

export const testUploadIntoBuckets = async (provider: FileStorageProvider) => {
	const docFile = createFile("report", { name: "report.pdf" });
	const imgFile = createFile("logo", { name: "logo.png" });

	const docId = await provider.upload("documents", docFile);
	const imgId = await provider.upload("images", imgFile);

	expect(await provider.exists("documents", docId)).toBe(true);
	expect(await provider.exists("images", imgId)).toBe(true);

	// Ensure files are in separate directories and not mixed up
	expect(await provider.exists("documents", imgId)).toBe(false);
	expect(await provider.exists("images", docId)).toBe(false);
};

export const testFileStream = async (provider: FileStorageProvider) => {
	const content = "Streaming content test.";
	const file = createFile(content, { name: "stream.txt", type: "text/plain" });

	const fileId = await provider.upload(BUCKET_NAME, file);
	const stream = await provider.download(BUCKET_NAME, fileId);

	expect(stream.name).toBe("stream.txt");
	expect(stream.type).toBe("text/plain");

	const streamContent = await stream.text();
	expect(streamContent).toBe(content);
};

export const testEmptyFiles = async (provider: FileStorageProvider) => {
	const emptyFile = createFile("", { name: "empty.txt", type: "text/plain" });

	const fileId = await provider.upload(BUCKET_NAME, emptyFile);
	const downloadedFile = await provider.download(BUCKET_NAME, fileId);

	expect(downloadedFile.name).toBe("empty.txt");
	expect(downloadedFile.type).toBe("text/plain");
	expect(downloadedFile.size).toBe(0);
	expect(await downloadedFile.text()).toBe("");
};

export const testCustomFileId = async (provider: FileStorageProvider) => {
	const file = createFile("custom id", { name: "custom.txt" });
	const customFileId = "custom-file-id";

	const uploadedFileId = await provider.upload(BUCKET_NAME, file, customFileId);

	expect(uploadedFileId).toBe(customFileId);

	const fileExists = await provider.exists(BUCKET_NAME, customFileId);
	expect(fileExists).toBe(true);
};

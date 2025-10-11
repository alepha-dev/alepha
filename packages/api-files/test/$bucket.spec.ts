import { randomUUID } from "node:crypto";
import {
	$bucket,
	FileNotFoundError,
	FileStorageProvider,
	LocalFileStorageProvider,
	MemoryFileStorageProvider,
} from "@alepha/bucket";
import { AzureFileStorageProvider } from "@alepha/bucket-azure";
import { Alepha, type Service } from "@alepha/core";
import { createFile } from "@alepha/file";
import { expect, test } from "vitest";
import { AlephaApiFiles } from "../src";

class A {
	images = $bucket({
		name: randomUUID(),
	});
}

const testStorageOperations = async (
	provider: Service<FileStorageProvider>,
) => {
	const alepha = Alepha.create()
		.with({
			provide: FileStorageProvider,
			use: provider,
		})
		.with(AlephaApiFiles);

	const assets = alepha.inject(A);

	await alepha.start();

	const blob = Buffer.from("Hello, World!");

	const fileId = await assets.images.upload(
		createFile(blob, {
			name: "hello.txt",
			type: "text/plain",
		}),
	);

	expect(await assets.images.exists(fileId)).toBe(true);

	const stream = await assets.images.download(fileId);
	expect(stream.name).toEqual("hello.txt");
	expect(stream.type).toEqual("text/plain");
	expect(await stream.arrayBuffer()).toEqual(blob.buffer);

	const file = await assets.images.download(fileId);

	expect(await file.text()).toEqual(blob.toString("utf-8"));

	await assets.images.delete(fileId);

	expect(await assets.images.exists(fileId)).toBe(false);

	await expect(() => assets.images.download(fileId)).rejects.toThrow(
		FileNotFoundError,
	);

	await expect(() => assets.images.delete(fileId)).rejects.toThrow(
		FileNotFoundError,
	);
};

test("$bucket - basic", async () => {
	await testStorageOperations(MemoryFileStorageProvider);
});

test("$bucket - basic (local)", async () => {
	await testStorageOperations(LocalFileStorageProvider);
});

test("$bucket - basic (azure)", async () => {
	await testStorageOperations(AzureFileStorageProvider);
});

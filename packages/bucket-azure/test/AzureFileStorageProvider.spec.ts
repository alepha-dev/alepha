import { FileStorageProvider } from "@alepha/bucket";
import { Alepha } from "@alepha/core";
import { file } from "@alepha/file";
import { describe, test } from "vitest";
import { AlephaBucketAzure, AzureFileStorageProvider } from "../src";

const alepha = Alepha.create().with(AlephaBucketAzure);

describe("AzureFileStorageProvider", () => {
	test("upload", async ({ expect }) => {
		const fileStorageProvider = alepha.get(FileStorageProvider);
		const azureFileStorageProvider = alepha.get(AzureFileStorageProvider);

		const container = "test-container";
		const message = "Hello World";
		const name = "hello.txt";
		const type = "text/plain";

		const f1 = file(message, {
			name,
			type,
		});

		await azureFileStorageProvider.createContainer(container);
		await fileStorageProvider.upload(container, f1, name);
		const exists = await fileStorageProvider.exists(container, name);
		expect(exists).toBe(true);

		const f2 = await fileStorageProvider.download(container, name);
		expect(f2.name).toBe(name);
		expect(f2.type).toBe(type);
		expect(await f2.text()).toBe(message);

		await fileStorageProvider.delete(container, name);
		const deleted = await fileStorageProvider.exists(container, name);
		expect(deleted).toBe(false);
	});
});

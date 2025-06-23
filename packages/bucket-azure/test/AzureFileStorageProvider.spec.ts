import { FileStorageProvider } from "@alepha/bucket";
import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { AzureBucketModule, AzureFileStorageProvider } from "../src";

describe("AzureFileStorageProvider", () => {
	test("create default provider", async ({ expect }) => {
		const alepha = Alepha.create().with(AzureBucketModule);
		const fileStorageProvider = alepha.get(FileStorageProvider);
		expect(fileStorageProvider).toBeInstanceOf(AzureFileStorageProvider);
	});
});

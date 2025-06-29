import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { AlephaBucket } from "../src";
import { FileStorageProvider } from "../src/providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../src/providers/MemoryFileStorageProvider.ts";

describe("FileStorageProvider", () => {
	test("create default provider", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaBucket);
		const fileStorageProvider = alepha.get(FileStorageProvider);
		expect(fileStorageProvider).toBeInstanceOf(MemoryFileStorageProvider);
	});
});

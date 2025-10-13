import { randomUUID } from "node:crypto";
import type * as fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
	$hook,
	$inject,
	Alepha,
	AlephaError,
	type FileLike,
	t,
} from "@alepha/core";
import { createFile } from "@alepha/file";
import { $logger } from "@alepha/logger";
import { $bucket } from "../descriptors/$bucket.ts";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import { FileMetadataService } from "../services/FileMetadataService.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

export class LocalFileStorageProvider implements FileStorageProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly metadataService = $inject(FileMetadataService);

	public options = {
		storagePath: this.alepha.isTest()
			? join(tmpdir(), `alepha-test-${Date.now()}`)
			: "files",
	};

	protected readonly configure = $hook({
		on: "start",
		handler: async () => {
			await mkdir(this.options.storagePath, { recursive: true });

			for (const bucket of this.alepha.descriptors($bucket)) {
				if (bucket.provider !== this) {
					continue;
				}

				await mkdir(join(this.options.storagePath, bucket.name), {
					recursive: true,
				});

				this.log.debug(
					`Bucket '${bucket.name}' at ${this.options.storagePath} OK`,
				);
			}
		},
	});

	public async upload(
		bucketName: string,
		file: FileLike,
		fileId?: string,
	): Promise<string> {
		fileId ??= this.createId();

		const { header, metadata } = this.metadataService.encodeMetadata(file);

		return new Promise((resolve, reject) => {
			const writeStream = createWriteStream(this.path(bucketName, fileId));
			writeStream.on("finish", () => resolve(fileId));
			writeStream.on("error", reject);

			writeStream.write(header);
			writeStream.write(metadata);
			Readable.from(file.stream()).pipe(writeStream);
		});
	}

	public async download(bucketName: string, fileId: string): Promise<FileLike> {
		const filePath = this.path(bucketName, fileId);

		let fileHandle: FileHandle | undefined;
		try {
			fileHandle = await open(filePath, "r");

			const { metadata, contentStart } =
				await this.metadataService.decodeMetadata(fileHandle);

			// get the total file size
			const stats = await fileHandle.stat();
			const contentSize = stats.size - contentStart;

			// create a FileLike object that streams only the content part!
			return createFile(createReadStream(filePath, { start: contentStart }), {
				name: metadata.name,
				type: metadata.type,
				size: contentSize,
			});
		} catch (error) {
			if (this.isErrorNoEntry(error)) {
				throw new FileNotFoundError(`File with ID ${fileId} not found.`);
			}
			throw new AlephaError("Invalid file operation", { cause: error });
		} finally {
			await fileHandle?.close();
		}
	}

	public async exists(bucketName: string, fileId: string): Promise<boolean> {
		try {
			await stat(this.path(bucketName, fileId));
			return true;
		} catch (error) {
			if (this.isErrorNoEntry(error)) {
				return false;
			}
			throw new AlephaError("Error checking file existence", { cause: error });
		}
	}

	public async delete(bucketName: string, fileId: string): Promise<void> {
		try {
			return await unlink(this.path(bucketName, fileId));
		} catch (error) {
			if (this.isErrorNoEntry(error)) {
				throw new FileNotFoundError(`File with ID ${fileId} not found.`);
			}
			throw new AlephaError("Error deleting file", { cause: error });
		}
	}

	protected stat(bucket: string, fileId: string): Promise<fs.Stats> {
		return stat(this.path(bucket, fileId));
	}

	protected createId(): string {
		return randomUUID();
	}

	protected path(bucket: string, fileId = ""): string {
		return join(this.options.storagePath, bucket, fileId);
	}

	protected isErrorNoEntry(error: unknown): boolean {
		return error instanceof Error && "code" in error && error.code === "ENOENT";
	}
}

export const fileMetadataSchema = t.object({
	name: t.text(),
	type: t.text(),
	size: t.number(),
});

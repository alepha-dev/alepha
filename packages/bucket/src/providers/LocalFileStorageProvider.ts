import { randomUUID } from "node:crypto";
import type * as fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, stat, unlink } from "node:fs/promises";
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
import { $bucket } from "../descriptors/$bucket.ts";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

export class LocalFileStorageProvider implements FileStorageProvider {
	public static METADATA_HEADER_LENGTH = 4;
	protected readonly alepha = $inject(Alepha);

	public options = {
		storagePath: "files",
	};

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			await mkdir(this.options.storagePath, { recursive: true });

			for (const bucket of this.alepha.descriptors($bucket)) {
				if (bucket.provider !== this) {
					continue;
				}

				await mkdir(join(this.options.storagePath, bucket.name), {
					recursive: true,
				});
			}
		},
	});

	public async upload(
		bucketName: string,
		file: FileLike,
		fileId?: string,
	): Promise<string> {
		fileId ??= this.createId();

		const metadata = Buffer.from(
			JSON.stringify({
				name: file.name,
				type: file.type,
			}),
			"utf8",
		);

		// file = [metadata.length] [metadata] <Buffer -- content -- />
		const header = Buffer.alloc(
			LocalFileStorageProvider.METADATA_HEADER_LENGTH,
		);
		header.writeUInt32BE(metadata.byteLength, 0);

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

			const headerLength = LocalFileStorageProvider.METADATA_HEADER_LENGTH;

			// read the header to get metadata length
			const headerBuffer = Buffer.alloc(headerLength);
			await fileHandle.read(headerBuffer, 0, headerLength, 0);
			const metadataLength = headerBuffer.readUInt32BE(0);
			const contentStart = headerLength + metadataLength;

			// read the metadata block
			const metadataBuffer = Buffer.alloc(metadataLength);
			await fileHandle.read(metadataBuffer, 0, metadataLength, headerLength);
			const metadata = JSON.parse(metadataBuffer.toString("utf8"));

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

	protected stat(container: string, fileId: string): Promise<fs.Stats> {
		return stat(this.path(container, fileId));
	}

	protected createId(): string {
		return randomUUID();
	}

	protected path(container: string, fileId = ""): string {
		return join(this.options.storagePath, container, fileId);
	}

	protected isErrorNoEntry(error: unknown): boolean {
		return error instanceof Error && "code" in error && error.code === "ENOENT";
	}
}

export const fileMetadataSchema = t.object({
	name: t.string(),
	type: t.string(),
	size: t.number(),
});

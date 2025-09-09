import type { Readable } from "node:stream";
import {
	$bucket,
	FileNotFoundError,
	type FileStorageProvider,
} from "@alepha/bucket";
import {
	$env,
	$hook,
	$inject,
	Alepha,
	AlephaError,
	type FileLike,
	type Static,
	t,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { createFile } from "@alepha/file";
import { $logger } from "@alepha/logger";
import { del, head, put } from "@vercel/blob";

const envSchema = t.object({
	BLOB_READ_WRITE_TOKEN: t.string({
		size: "long",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Vercel Blob Storage implementation of File Storage Provider.
 */
export class VercelFileStorageProvider implements FileStorageProvider {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly time = $inject(DateTimeProvider);
	protected readonly stores: Set<string> = new Set();

	protected readonly onStart = $hook({
		on: "start",
		handler: async () => {
			for (const bucket of this.alepha.descriptors($bucket)) {
				if (bucket.provider !== this) {
					continue;
				}

				const storeName = this.convertName(bucket.name);

				this.log.debug(`Prepare store '${storeName}' ...`);

				// Vercel Blob doesn't require explicit store/container creation
				// We just track the store names for reference
				this.stores.add(storeName);

				this.log.info(`Store '${bucket.name}' OK`);
			}
		},
	});

	public convertName(name: string): string {
		// Convert to a valid path-like name for Vercel Blob
		return name.replaceAll("/", "-").toLowerCase();
	}

	public async upload(
		bucketName: string,
		file: FileLike,
		fileId?: string,
	): Promise<string> {
		// force file id as filename for Vercel because we can't store filename as metadata
		// it's bad, but we have no choice for now
		fileId = file.name;

		this.log.trace(
			`Uploading file '${file.name}' to bucket '${bucketName}' with id '${fileId}'...`,
		);

		const storeName = this.convertName(bucketName);
		const pathname = `${storeName}/${fileId}`;

		try {
			const result = await put(pathname, file.stream() as Readable, {
				access: "public",
				contentType: file.type,
				token: this.env.BLOB_READ_WRITE_TOKEN,
			});

			this.log.trace(`File uploaded successfully: ${result.url}`);
			return fileId;
		} catch (error) {
			this.log.error(`Failed to upload file: ${error}`);
			if (error instanceof Error) {
				throw new AlephaError(`Upload failed: ${error.message}`, {
					cause: error,
				});
			}

			throw error;
		}
	}

	public async download(bucketName: string, fileId: string): Promise<FileLike> {
		this.log.trace(
			`Downloading file '${fileId}' from bucket '${bucketName}'...`,
		);

		const storeName = this.convertName(bucketName);
		const pathname = `${storeName}/${fileId}`;

		try {
			// check if the file exists and get metadata
			const headResult = await head(pathname, {
				token: this.env.BLOB_READ_WRITE_TOKEN,
			});

			if (!headResult) {
				throw new FileNotFoundError(
					`File '${fileId}' not found in bucket '${bucketName}'`,
				);
			}

			// fetch the actual file content
			const response = await fetch(headResult.url);

			if (!response.ok) {
				throw new FileNotFoundError(
					`Failed to fetch file: ${response.statusText}`,
				);
			}

			const stream = response.body;
			if (!stream) {
				throw new FileNotFoundError("File not found - empty response body");
			}

			const originalType =
				response.headers.get("Content-Type") || "application/octet-stream";

			return createFile(stream, {
				name: fileId,
				type: originalType,
				size: headResult.size,
			});
		} catch (error) {
			if (error instanceof FileNotFoundError) {
				throw error;
			}

			this.log.error(`Failed to download file: ${error}`);
			if (error instanceof Error) {
				throw new FileNotFoundError("Error downloading file", { cause: error });
			}

			throw error;
		}
	}

	public async exists(bucketName: string, fileId: string): Promise<boolean> {
		this.log.trace(
			`Checking existence of file '${fileId}' in bucket '${bucketName}'...`,
		);

		const storeName = this.convertName(bucketName);
		const pathname = `${storeName}/${fileId}`;

		try {
			const result = await head(pathname, {
				token: this.env.BLOB_READ_WRITE_TOKEN,
			});
			return result !== null;
		} catch (error) {
			// Vercel Blob head() throws for non-existent files
			return false;
		}
	}

	public async delete(bucketName: string, fileId: string): Promise<void> {
		this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);

		const storeName = this.convertName(bucketName);
		const pathname = `${storeName}/${fileId}`;

		try {
			await del(pathname, {
				token: this.env.BLOB_READ_WRITE_TOKEN,
			});
		} catch (error) {
			this.log.error(`Failed to delete file: ${error}`);
			if (error instanceof Error) {
				throw new FileNotFoundError("Error deleting file", { cause: error });
			}
			throw error;
		}
	}
}

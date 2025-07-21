import {
	createDescriptor,
	Descriptor,
	type FileLike,
	KIND,
	type Service,
} from "@alepha/core";
import { createFile } from "@alepha/file";
import { InvalidFileError } from "../errors/InvalidFileError.ts";
import { FileStorageProvider } from "../providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";

/**
 * Create a container for storing files.
 *
 * @example
 * ```ts
 * import { $bucket } from "@alepha/bucket";
 *
 * class App {
 *   images = $bucket();
 *
 *   uploadImage(file: FileLike): Promise<string> {
 *     return this.images.upload(file);
 *   }
 * }
 * ```
 */
export const $bucket = (options: BucketDescriptorOptions) =>
	createDescriptor(BucketDescriptor, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface BucketDescriptorOptions extends BucketFileOptions {
	/**
	 * File storage provider. If not provided, the default provider will be used.
	 */
	provider?: Service<FileStorageProvider> | "memory";

	/**
	 * Optional name of the bucket. If not provided, the key of the descriptor will be used.
	 */
	name?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class BucketDescriptor extends Descriptor<BucketDescriptorOptions> {
	public readonly provider = this.$provider();

	public get name() {
		return this.options.name ?? `${this.config.propertyKey}`;
	}

	/**
	 * Uploads a file to the bucket.
	 */
	public async upload(
		file: FileLike,
		options?: BucketFileOptions,
	): Promise<string> {
		if (file instanceof File) {
			// our createFile is smarter than the browser's File constructor
			// by doing this, we can guess the MIME type and size!
			file = createFile(file);
		}

		options = {
			...this.options,
			...options,
		};

		const mimeTypes = options.mimeTypes ?? undefined;
		const maxSize = options.maxSize ?? 10; // Default to 10 MB if not specified

		if (mimeTypes) {
			const mimeType = file.type || "application/octet-stream";
			if (!mimeTypes.includes(mimeType)) {
				throw new InvalidFileError(
					`MIME type ${mimeType} is not allowed in bucket ${this.name}`,
				);
			}
		}

		if (file.size > maxSize * 1024 * 1024) {
			throw new InvalidFileError(
				`File size ${file.size} exceeds the maximum size of ${this.options.maxSize} MB in bucket ${this.name}`,
			);
		}

		const id = await this.provider.upload(this.name, file);

		await this.alepha.emit("bucket:file:uploaded", {
			id,
			bucket: this,
			file,
			options,
		});

		return id;
	}

	/**
	 * Delete permanently a file from the bucket.
	 */
	public async delete(fileId: string): Promise<void> {
		await this.provider.delete(this.name, fileId);
		await this.alepha.emit("bucket:file:deleted", {
			id: fileId,
			bucket: this,
		});
	}

	/**
	 * Checks if a file exists in the bucket.
	 */
	public async exists(fileId: string): Promise<boolean> {
		return this.provider.exists(this.name, fileId);
	}

	/**
	 * Downloads a file from the bucket.
	 */
	public async download(fileId: string): Promise<FileLike> {
		return this.provider.download(this.name, fileId);
	}

	protected $provider() {
		if (!this.options.provider) {
			return this.alepha.get(FileStorageProvider);
		}
		if (this.options.provider === "memory") {
			return this.alepha.get(MemoryFileStorageProvider);
		}
		return this.alepha.get(this.options.provider);
	}
}

$bucket[KIND] = BucketDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface BucketFileOptions {
	/**
	 * Optional description of the bucket.
	 */
	description?: string;

	/**
	 * Allowed MIME types.
	 */
	mimeTypes?: string[];

	/**
	 * Maximum size of the files in the bucket.
	 *
	 * @default 10
	 */
	maxSize?: number;
}

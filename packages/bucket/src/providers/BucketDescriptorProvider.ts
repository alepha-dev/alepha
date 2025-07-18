import {
	$hook,
	$inject,
	Alepha,
	type FileLike,
	KIND,
	OPTIONS,
} from "@alepha/core";
import { createFile } from "@alepha/file";
import {
	$bucket,
	type BucketDescriptor,
	type BucketDescriptorOptions,
} from "../descriptors/$bucket.ts";
import { InvalidFileError } from "../errors/InvalidFileError.ts";
import { FileStorageProvider } from "./FileStorageProvider.ts";

export class BucketDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly buckets: Array<Bucket> = [];

	public readonly onConfigure = $hook({
		on: "configure",
		handler: () => {
			const buckets = this.alepha.getDescriptorValues($bucket);
			for (const { value, instance, key } of buckets) {
				const options = value[OPTIONS];
				const name = options.name ?? key;
				const provider =
					options.provider ?? this.alepha.get(FileStorageProvider);
				const bucket = {
					name,
					provider,
					options,
				};

				this.buckets.push(bucket);

				instance[key] = this.createApi(bucket);
			}
		},
	});

	public async upload(
		bucketName: string | Bucket,
		file: FileLike,
	): Promise<string> {
		if (file instanceof File) {
			// our createFile is smarter than the browser's File constructor
			// by doing this, we can guess the MIME type and size!
			file = createFile(file);
		}

		const bucket =
			typeof bucketName === "object"
				? bucketName
				: this.buckets.find((b) => b.name === bucketName);

		if (!bucket) {
			throw new Error(`Bucket ${bucketName} not found`);
		}

		if (bucket.options.mimeTypes) {
			const mimeType = file.type || "application/octet-stream";
			if (!bucket.options.mimeTypes.includes(mimeType)) {
				throw new InvalidFileError(
					`MIME type ${mimeType} is not allowed in bucket ${bucket.name}`,
				);
			}
		}

		const maxSize = bucket.options.maxSize ?? 10; // Default to 10 MB if not specified
		if (file.size > maxSize * 1024 * 1024) {
			throw new InvalidFileError(
				`File size ${file.size} exceeds the maximum size of ${bucket.options.maxSize} MB in bucket ${bucket.name}`,
			);
		}

		const id = await bucket.provider.upload(bucket.name, file);

		await this.alepha.emit("bucket:file:uploaded", {
			id,
			bucket: bucket.name,
			...file,
		});

		return id;
	}

	public async delete(
		bucketName: string | Bucket,
		fileId: string,
	): Promise<void> {
		const bucket =
			typeof bucketName === "object"
				? bucketName
				: this.buckets.find((b) => b.name === bucketName);

		if (!bucket) {
			throw new Error(`Bucket ${bucketName} not found`);
		}

		await bucket.provider.delete(bucket.name, fileId);

		await this.alepha.emit("bucket:file:deleted", {
			id: fileId,
			bucket: bucket.name,
		});
	}

	protected createApi(bucket: Bucket): BucketDescriptor {
		return {
			[KIND]: "BUCKET",
			[OPTIONS]: bucket.options,
			get name() {
				return bucket.name;
			},
			get provider() {
				return bucket.provider;
			},
			upload: async (file: FileLike) => this.upload(bucket, file),
			delete: (fileId: string) => this.delete(bucket, fileId),
			download: (fileId: string) =>
				bucket.provider.download(bucket.name, fileId),
			exists: (fileId: string) => bucket.provider.exists(bucket.name, fileId),
		};
	}

	public getBuckets(): Array<Bucket> {
		return this.buckets;
	}
}

export interface Bucket {
	name: string;
	provider: FileStorageProvider;
	options: BucketDescriptorOptions;
}

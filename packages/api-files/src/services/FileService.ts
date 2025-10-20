import { $bucket, type BucketDescriptor } from "@alepha/bucket";
import { $hook, $inject, Alepha, type FileLike } from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { $repository, type Page } from "@alepha/postgres";
import type { UserAccountToken } from "@alepha/security";
import type { Ok } from "@alepha/server";
import { NotFoundError } from "@alepha/server";
import { type FileEntity, files } from "../entities/files.ts";
import type { FileQuery } from "../schemas/fileQuerySchema.ts";
import type { FileResource } from "../schemas/fileResourceSchema.ts";

export class FileService {
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly fileRepository = $repository(files);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly defaultBucket = $bucket({ name: "default" });

	protected onUploadFile = $hook({
		on: "bucket:file:uploaded",
		handler: async ({ file, bucket, options, id }) => {
			if (options.persist === false) {
				return;
			}

			await this.fileRepository.create({
				blobId: id,
				mimeType: file.type,
				name: file.name,
				size: file.size,
				creator: options.user?.id,
				creatorRealm: options.user?.realm,
				expirationDate: this.getExpirationDate(options.ttl),
				bucket: bucket.name,
			});
		},
	});

	protected onDeleteBucketFile = $hook({
		on: "bucket:file:deleted",
		handler: async ({ bucket, id }) => {
			await this.fileRepository.deleteMany({
				blobId: { eq: id },
				bucket: { eq: bucket.name },
			});
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	public bucket(
		bucketName: string = this.defaultBucket.name,
	): BucketDescriptor {
		const bucket = this.alepha
			.descriptors($bucket)
			.find((it) => it.name === bucketName);

		if (!bucket) {
			throw new NotFoundError(`Bucket '${bucketName}' not found.`);
		}

		return bucket;
	}

	// -------------------------------------------------------------------------------------------------------------------

	public async findFiles(q: FileQuery = {}): Promise<Page<FileEntity>> {
		q.sort ??= "-createdAt";

		const where = this.fileRepository.createQueryWhere();
		if (q.bucket) {
			where.bucket = { eq: q.bucket };
		}

		if (q.tags) {
			where.tags = { arrayContains: q.tags };
		}

		return await this.fileRepository
			.paginate(q, { where }, { count: true })
			.then((page) => {
				return {
					...page,
					content: page.content.map((it) => this.entityToResource(it)),
				};
			});
	}

	public async findExpiredFiles(): Promise<FileEntity[]> {
		return await this.fileRepository.find({
			limit: 1000,
			where: {
				expirationDate: { lte: this.dateTimeProvider.nowISOString() },
			},
		});
	}

	protected getExpirationDate(ttl?: DurationLike): string | undefined {
		return ttl
			? (this.dateTimeProvider
					.now()
					.add(this.dateTimeProvider.duration(ttl))
					.toISOString() ?? undefined)
			: undefined;
	}

	public async uploadFile(
		file: FileLike,
		options: {
			expirationDate?: string | Date;
			bucket?: string;
			user?: UserAccountToken;
			tags?: string[];
		} = {},
	): Promise<FileEntity> {
		const bucket = this.bucket(options.bucket);

		const blobId = await bucket.upload(file, { persist: false });

		let expirationDate: string | undefined;
		if (options.expirationDate) {
			if (options.expirationDate instanceof Date) {
				expirationDate = options.expirationDate.toISOString();
			} else {
				expirationDate = new Date(options.expirationDate).toISOString();
			}
		} else if (bucket.options.ttl) {
			expirationDate = this.getExpirationDate(bucket.options.ttl);
		}

		return await this.fileRepository.create({
			blobId: blobId,
			mimeType: file.type,
			name: file.name,
			size: file.size,
			creator: options.user?.id,
			creatorRealm: options.user?.realm,
			creatorName: options.user?.name,
			expirationDate,
			bucket: bucket.name,
			tags: options.tags,
		});
	}

	public async streamFile(id: string): Promise<FileLike> {
		const entity = await this.getFileById(id);
		const bucket = this.bucket(entity.bucket);

		return await bucket.download(entity.blobId);
	}

	public async deleteFile(id: string): Promise<Ok> {
		const file = await this.getFileById(id);

		try {
			const bucket = this.bucket(file.bucket);
			await bucket.delete(file.blobId);
		} catch (e) {
			// sometimes, file is already deleted in the bucket
			this.log.warn("Failed to delete file from bucket", e);
			await this.fileRepository.deleteById(file.id);
		}

		return { ok: true, id: String(file.id) };
	}

	public async getFileById(id: string | FileEntity): Promise<FileEntity> {
		if (typeof id === "object") {
			return id;
		}

		return await this.fileRepository.findById(id);
	}

	public entityToResource(entity: FileEntity): FileResource {
		return entity;
	}
}

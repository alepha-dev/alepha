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
	protected readonly defaultBucket = $bucket({ name: "files" });

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
				container: bucket.name,
			});
		},
	});

	protected onDeleteBucketFile = $hook({
		on: "bucket:file:deleted",
		handler: async ({ bucket, id }) => {
			await this.fileRepository.deleteMany({
				blobId: { eq: id },
				container: { eq: bucket.name },
			});
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	public storage(
		storageName: string = this.defaultBucket.name,
	): BucketDescriptor {
		const storage = this.alepha
			.descriptors($bucket)
			.find((it) => it.name === storageName);

		if (!storage) {
			throw new NotFoundError(`Storage '${storageName}' not found.`);
		}

		return storage;
	}

	// -------------------------------------------------------------------------------------------------------------------

	public async findFiles(q: FileQuery): Promise<Page<FileEntity>> {
		q.sort ??= "-createdAt";

		const where = this.fileRepository.createQueryWhere();
		if (q.container) {
			where.container = { eq: q.container };
		}

		if (q.tags) {
			where.tags = { arrayContains: q.tags };
		}

		return await this.fileRepository.paginate(q, { where }).then((page) => {
			return {
				...page,
				content: page.content.map((it) => this.entityToResource(it)),
			};
		});
	}

	public async findExpiredFiles(): Promise<FileEntity[]> {
		return await this.fileRepository.find({
			limit: 100,
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
			expirationDate?: string;
			container?: string;
			user?: UserAccountToken;
			tags?: string[];
		} = {},
	): Promise<FileEntity> {
		const storage = this.storage(options.container);

		const blobId = await storage.upload(file, { persist: false });

		return await this.fileRepository.create({
			blobId: blobId,
			mimeType: file.type,
			name: file.name,
			size: file.size,
			creator: options.user?.id,
			creatorRealm: options.user?.realm,
			creatorName: options.user?.name,
			expirationDate: options.expirationDate,
			container: storage.name,
			tags: options.tags,
		});
	}

	public async streamFile(id: string): Promise<FileLike> {
		const file = await this.getFileById(id);

		const storage = this.storage(file.container);

		return await storage.download(file.blobId);
	}

	public async deleteFile(id: string): Promise<Ok> {
		const file = await this.getFileById(id);

		try {
			const storage = this.storage(file.container);
			await storage.delete(file.blobId);
		} catch (e) {
			// sometimes, file is already deleted in the storage
			this.log.warn("Failed to delete file from storage", e);
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

import { $inject } from "alepha";
import { FileService, files } from "alepha/api/files";
import { $repository, $sequence } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";
import { type ArchiveBlob, archiveBlobs } from "../entities/archiveBlobs.ts";
import { ArchiveDirectoryService } from "./ArchiveDirectoryService.ts";
import { ArchiveNameService } from "./ArchiveNameService.ts";

/**
 * Lore-side blob operations on top of the framework `FileService`. The
 * framework owns the bytes + the upload/download flow; we own the
 * campaign + directory placement and the name-reservation glue.
 *
 * The bucket name `archive-blobs` is allocated here so per-campaign
 * separation isn't required at the framework layer — each archive_blob
 * row maps to one `files` row with `bucket = 'archive-blobs'`.
 */
const ARCHIVE_BLOB_BUCKET = "archive-blobs";

export class ArchiveBlobService {
  protected readonly blobs = $repository(archiveBlobs);
  protected readonly frameworkFiles = $repository(files);
  protected readonly directoryService = $inject(ArchiveDirectoryService);
  protected readonly names = $inject(ArchiveNameService);
  protected readonly fileService = $inject(FileService);
  protected readonly blobShortId = $sequence();

  public async findById(fileId: string): Promise<ArchiveBlob | undefined> {
    return this.blobs.findOne({ where: { fileId: { eq: fileId } } });
  }

  public async findByShortId(
    campaignId: number,
    shortId: number,
  ): Promise<ArchiveBlob | undefined> {
    return this.blobs.findOne({
      where: {
        campaignId: { eq: campaignId },
        shortId: { eq: shortId },
      },
    });
  }

  public async listInDirectory(
    campaignId: number,
    directoryId: string | undefined,
  ): Promise<ArchiveBlob[]> {
    return this.blobs.findMany({
      where: directoryId
        ? { directoryId: { eq: directoryId } }
        : {
            campaignId: { eq: campaignId },
            directoryId: { isNull: true },
          },
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  /**
   * Register an Archive blob on top of an already-uploaded framework
   * file. Caller is responsible for the upload flow (typically via
   * framework `FileController` endpoints — Lore does not currently
   * expose an MCP-side upload; uploads happen via HTTP). We wire the
   * metadata and reserve the name.
   *
   * The framework file must already exist and live in the
   * `archive-blobs` bucket — both are validated here. The Archive
   * blob row is created with the given `directoryId` (or root if
   * undefined); the name is auto-suffixed on collision.
   */
  public async register(input: {
    campaignId: number;
    directoryId?: string;
    name: string;
    fileId: string;
  }): Promise<ArchiveBlob> {
    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== ARCHIVE_BLOB_BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${ARCHIVE_BLOB_BUCKET}'`,
      );
    }
    if (input.directoryId) {
      const directory = await this.directoryService.findById(input.directoryId);
      if (!directory || directory.campaignId !== input.campaignId) {
        throw new BadRequestError(
          "Target directory not found in this campaign",
        );
      }
    }

    const scope = this.directoryService.scopeOf(
      input.campaignId,
      input.directoryId,
    );
    const name = await this.names.autoSuffix(input.name, scope);
    const shortId = await this.blobShortId.next(String(input.campaignId));
    const blob = await this.blobs.create({
      fileId: input.fileId,
      campaignId: input.campaignId,
      directoryId: input.directoryId,
      shortId,
      name,
    });
    await this.names.reserve(name, "blob", input.fileId, scope);
    return blob;
  }

  public async rename(fileId: string, name: string): Promise<ArchiveBlob> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    const scope = this.directoryService.scopeOf(
      blob.campaignId,
      blob.directoryId,
    );
    // Release first: autoSuffix counts the entity's own current
    // reservation as a sibling otherwise (rename "Abc" → "abc" would
    // resolve to "abc (1)"). The enclosing controller is $transactional.
    await this.names.releaseByEntity(fileId);
    const nextName = await this.names.autoSuffix(name, scope);
    await this.names.reserve(nextName, "blob", fileId, scope);
    return this.blobs.updateById(fileId, { name: nextName });
  }

  public async move(
    fileId: string,
    newDirectoryId: string | undefined,
  ): Promise<ArchiveBlob> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    if (newDirectoryId) {
      const directory = await this.directoryService.findById(newDirectoryId);
      if (!directory || directory.campaignId !== blob.campaignId) {
        throw new BadRequestError(
          "Target directory not found in this campaign",
        );
      }
    }
    const scope = this.directoryService.scopeOf(
      blob.campaignId,
      newDirectoryId,
    );
    // Release first — see rename() above. Move-to-same-parent would
    // otherwise see the entity's own reservation as a collision.
    await this.names.releaseByEntity(fileId);
    const nextName = await this.names.autoSuffix(blob.name, scope);
    await this.names.reserve(nextName, "blob", fileId, scope);
    return this.blobs.updateById(fileId, {
      directoryId: newDirectoryId,
      name: nextName,
    });
  }

  /**
   * Delete the blob row AND the underlying framework file (so storage
   * is reclaimed). Caller may want a soft-delete flow later; for v1
   * delete is hard delete.
   */
  public async delete(fileId: string): Promise<void> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    await this.names.releaseByEntity(fileId);
    // FK from archive_blobs.fileId → files.id has CASCADE: deleting
    // the framework file row also drops the archive_blobs row. Use the
    // framework service so storage gets reclaimed too.
    await this.fileService.deleteFile(fileId);
  }
}

export const ARCHIVE_BLOB_BUCKET_NAME = ARCHIVE_BLOB_BUCKET;

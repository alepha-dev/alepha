import { $inject } from "alepha";
import { FileService, files } from "alepha/api/files";
import { $repository, $sequence } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";
import { type FolioBlob, folioBlobs } from "../entities/folioBlobs.ts";
import { FolioDirectoryService } from "./FolioDirectoryService.ts";
import { FolioNameService } from "./FolioNameService.ts";

/**
 * Lore-side blob operations on top of the framework `FileService`. The
 * framework owns the bytes + the upload/download flow; we own the
 * project + directory placement and the name-reservation glue.
 *
 * The bucket name `archive-blobs` is allocated here so per-project
 * separation isn't required at the framework layer — each folio_blob
 * row maps to one `files` row with `bucket = 'archive-blobs'`. Kept as
 * `archive-blobs` rather than renamed to `folio-blobs`: it's a value
 * already persisted on every existing `files` row, not just an
 * in-code identifier — same reasoning that keeps
 * `FeedbackRateLimiter.ATTACHMENT_BUCKET` at `"petition-attachments"`
 * after the Petitions → Feedback rename.
 */
const FOLIO_BLOB_BUCKET = "archive-blobs";

export class FolioBlobService {
  protected readonly blobs = $repository(folioBlobs);
  protected readonly frameworkFiles = $repository(files);
  protected readonly directoryService = $inject(FolioDirectoryService);
  protected readonly names = $inject(FolioNameService);
  protected readonly fileService = $inject(FileService);
  protected readonly blobShortId = $sequence();

  public async findById(fileId: string): Promise<FolioBlob | undefined> {
    return this.blobs.findOne({ where: { fileId: { eq: fileId } } });
  }

  public async findByShortId(
    projectId: number,
    shortId: number,
  ): Promise<FolioBlob | undefined> {
    return this.blobs.findOne({
      where: {
        projectId: { eq: projectId },
        shortId: { eq: shortId },
      },
    });
  }

  /**
   * Every blob in the project, flat.
   *
   * Mirrors `listAllDirectories`: the folio tree is assembled in the browser
   * from flat lists, so it needs the whole set in one call rather than a
   * `listContents` per directory. `listInDirectory` cannot stand in — called
   * without a directory it means "the project root", not "everywhere".
   */
  public async listAll(projectId: number): Promise<FolioBlob[]> {
    return this.blobs.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 1000,
    });
  }

  public async listInDirectory(
    projectId: number,
    directoryId: string | undefined,
  ): Promise<FolioBlob[]> {
    return this.blobs.findMany({
      where: directoryId
        ? { directoryId: { eq: directoryId } }
        : {
            projectId: { eq: projectId },
            directoryId: { isNull: true },
          },
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  /**
   * Register a folio blob on top of an already-uploaded framework
   * file. Caller is responsible for the upload flow (typically via
   * framework `FileController` endpoints — Lore does not currently
   * expose an MCP-side upload; uploads happen via HTTP). We wire the
   * metadata and reserve the name.
   *
   * The framework file must already exist and live in the
   * `archive-blobs` bucket — both are validated here. The folio
   * blob row is created with the given `directoryId` (or root if
   * undefined); the name is auto-suffixed on collision.
   */
  public async register(input: {
    projectId: number;
    directoryId?: string;
    name: string;
    fileId: string;
  }): Promise<FolioBlob> {
    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== FOLIO_BLOB_BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${FOLIO_BLOB_BUCKET}'`,
      );
    }
    if (input.directoryId) {
      const directory = await this.directoryService.findById(input.directoryId);
      if (!directory || directory.projectId !== input.projectId) {
        throw new BadRequestError("Target directory not found in this project");
      }
    }

    const scope = this.directoryService.scopeOf(
      input.projectId,
      input.directoryId,
    );
    const name = await this.names.autoSuffix(input.name, scope);
    const shortId = await this.blobShortId.next(String(input.projectId));
    const blob = await this.blobs.create({
      fileId: input.fileId,
      projectId: input.projectId,
      directoryId: input.directoryId,
      shortId,
      name,
    });
    await this.names.reserve(name, "blob", input.fileId, scope);
    return blob;
  }

  public async rename(fileId: string, name: string): Promise<FolioBlob> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    const scope = this.directoryService.scopeOf(
      blob.projectId,
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
  ): Promise<FolioBlob> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    if (newDirectoryId) {
      const directory = await this.directoryService.findById(newDirectoryId);
      if (!directory || directory.projectId !== blob.projectId) {
        throw new BadRequestError("Target directory not found in this project");
      }
    }
    const scope = this.directoryService.scopeOf(blob.projectId, newDirectoryId);
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
    // FK from folio_blobs.fileId → files.id has CASCADE: deleting
    // the framework file row also drops the folio_blobs row. Use the
    // framework service so storage gets reclaimed too.
    await this.fileService.deleteFile(fileId);
  }
}

export const FOLIO_BLOB_BUCKET_NAME = FOLIO_BLOB_BUCKET;

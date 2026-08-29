import { $inject } from "alepha";
import { FileService, files } from "alepha/api/files";
import { $repository, $sequence } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

// A zero-dependency pure helper, deliberately shared with the browser: the
// two writers and the reader of an `assets/` reference must agree on the
// encoding exactly, and a second copy here is how that stops being true.
import { folioAssetPath } from "../../web/app/components/folios/folioAssetReference.ts";
import { type FolioBlob, folioBlobs } from "../entities/folioBlobs.ts";
import { folios } from "../entities/folios.ts";
import type { HydratedBlob } from "../schemas/hydratedBlobSchema.ts";

/**
 * Lore-side blob operations on top of the framework `FileService`. The
 * framework owns the bytes + the upload/download flow; we own the
 * placement of an attachment on its folio and the sibling-name rule.
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
export class FolioBlobService {
  /**
   * Static so `BlobController.folioBucket` can name it from a field
   * initializer, the same way `FeedbackRateLimiter.ATTACHMENT_BUCKET` is
   * read by `FeedbackController`.
   */
  static readonly BUCKET = "archive-blobs";

  protected readonly blobs = $repository(folioBlobs);
  protected readonly folioRows = $repository(folios);
  protected readonly frameworkFiles = $repository(files);
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
   * Every attachment on one folio, which is the only listing the UI or
   * an export ever needs — an attachment has no existence outside its
   * folio.
   */
  public async listByFolio(folioId: string): Promise<FolioBlob[]> {
    return this.blobs.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 1000,
    });
  }

  /**
   * `listByFolio`, joined with the framework `files` rows that carry the
   * size / mimeType / checksum every listing displays.
   *
   * Two queries regardless of how many attachments the folio has. The
   * caller this replaced (`BlobController.listBlobs`) hydrated one blob at
   * a time and each hydrate was itself two queries — 2N+1 for a list that
   * loads on every folio open. Both readers go through here now, so the
   * shape can only be built one way.
   */
  public async listHydratedByFolio(folioId: string): Promise<HydratedBlob[]> {
    const blobs = await this.listByFolio(folioId);
    if (blobs.length === 0) return [];
    const rows = await this.frameworkFiles.findMany({
      where: { id: { inArray: blobs.map((b) => b.fileId) } },
    });
    const fileById = new Map(rows.map((f) => [f.id, f]));
    const hydrated: HydratedBlob[] = [];
    for (const blob of blobs) {
      const file = fileById.get(blob.fileId);
      // A blob whose framework file went missing is skipped rather than
      // rendered half-empty — same call the per-row `hydrate` made by
      // returning `undefined` and being filtered out.
      if (!file) continue;
      hydrated.push({
        id: blob.fileId,
        shortId: blob.shortId,
        projectId: blob.projectId,
        folioId: blob.folioId,
        name: blob.name,
        createdAt: blob.createdAt,
        updatedAt: blob.updatedAt,
        size: file.size,
        mimeType: file.mimeType,
        sha256: file.checksum,
        originalName: file.originalName,
        tags: file.tags,
      });
    }
    return hydrated;
  }

  /**
   * Register a folio blob on top of an already-uploaded framework
   * file. Caller is responsible for the upload flow (typically via
   * framework `FileController` endpoints — Lore does not currently
   * expose an MCP-side upload; uploads happen via HTTP). We wire the
   * metadata and resolve the name.
   *
   * The framework file must already exist and live in the
   * `archive-blobs` bucket — both are validated here. The name is
   * auto-suffixed on collision with another attachment of the same
   * folio.
   */
  public async register(input: {
    projectId: number;
    folioId: string;
    name: string;
    fileId: string;
  }): Promise<FolioBlob> {
    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== FolioBlobService.BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${FolioBlobService.BUCKET}'`,
      );
    }

    const folio = await this.folioRows.findOne({
      where: { id: { eq: input.folioId } },
    });
    if (!folio || folio.projectId !== input.projectId) {
      throw new BadRequestError("Target folio not found in this project");
    }

    const name = await this.autoSuffix(input.name, input.folioId);
    const shortId = await this.blobShortId.next(String(input.projectId));
    return this.blobs.create({
      fileId: input.fileId,
      projectId: input.projectId,
      folioId: input.folioId,
      shortId,
      name,
    });
  }

  public async rename(fileId: string, name: string): Promise<FolioBlob> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");
    const nextName = await this.autoSuffix(name, blob.folioId, fileId);
    const renamed = await this.blobs.updateById(fileId, { name: nextName });
    await this.rewriteReferences(blob.folioId, blob.name, nextName);
    return renamed;
  }

  /**
   * Repoint every `assets/<old>` reference in the owning folio at the new
   * name.
   *
   * The cost of addressing attachments by name rather than by id (which is
   * what makes an export portable — see `useFolioImageUpload`): a rename
   * that skipped this would leave every embed in the document resolving to
   * nothing, silently, with the image still present in the panel.
   *
   * Deliberately NOT done for a protected folio: `content` there is a
   * client-side encryption envelope the server cannot read, let alone
   * rewrite. Attachments on a protected folio are refused upstream, so this
   * is a guard against a folio that was encrypted after the fact rather
   * than a reachable path.
   */
  protected async rewriteReferences(
    folioId: string,
    from: string,
    to: string,
  ): Promise<void> {
    if (from === to) return;
    const folio = await this.folioRows.findOne({
      where: { id: { eq: folioId } },
    });
    if (!folio?.content || folio.protected) return;

    // Match the encoded and the bare form, since the writers percent-encode
    // but hand-typed markdown will not. The replacement goes through
    // `folioAssetPath` rather than `encodeURIComponent` so this cannot drift
    // from what the reader accepts — the difference is parentheses, which
    // `encodeURIComponent` leaves alone and markdown treats as terminators,
    // and which `autoSuffix` puts in every collision name.
    const candidates = new Set([
      from,
      encodeURIComponent(from),
      folioAssetPath(from).slice("assets/".length),
    ]);
    const replacement = `](${folioAssetPath(to)})`;
    let content = folio.content;
    for (const candidate of candidates) {
      content = content.split(`](assets/${candidate})`).join(replacement);
    }
    if (content === folio.content) return;
    await this.folioRows.updateById(folioId, { content });
  }

  /**
   * First free name of the form `base`, `base (1)`, `base (2)`, … among
   * the attachments of `folioId`. Drive-style, and the same shape
   * `FolioNameService.autoSuffix` gives folios and directories — but
   * resolved against this folio's own attachments rather than the
   * `folio_names` reservation table, which attachments left when they
   * stopped being siblings of anything.
   *
   * `exceptFileId` skips the row being renamed. Without it a rename
   * that only changes case ("Abc" → "abc") would count the entity's own
   * current name as a collision and resolve to "abc (1)".
   */
  public async autoSuffix(
    desired: string,
    folioId: string,
    exceptFileId?: string,
  ): Promise<string> {
    const siblings = await this.blobs.findMany({
      where: { folioId: { eq: folioId } },
      columns: ["fileId", "name"],
      limit: 1000,
    });
    const taken = new Set(
      siblings
        .filter((row) => row.fileId !== exceptFileId)
        .map((row) => row.name.trim().toLowerCase()),
    );

    const wanted = desired.trim();
    if (!taken.has(wanted.toLowerCase())) return wanted;

    const { stem, ext } = this.splitExtension(wanted);
    for (let n = 1; n < 10_000; n++) {
      const candidate = ext ? `${stem} (${n})${ext}` : `${stem} (${n})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw new BadRequestError(
      "Too many attachments with this name on this folio",
    );
  }

  /**
   * Drive-style split: `stem` without the trailing extension, `ext`
   * with its leading dot (or "" when there is none). A dotfile like
   * `.gitignore` is all stem, matching Drive.
   */
  protected splitExtension(name: string): { stem: string; ext: string } {
    if (name.startsWith(".")) return { stem: name, ext: "" };
    const index = name.lastIndexOf(".");
    if (index <= 0) return { stem: name, ext: "" };
    return { stem: name.slice(0, index), ext: name.slice(index) };
  }

  /**
   * Delete the blob row AND the underlying framework file, so the bytes
   * are reclaimed. For v1 delete is hard delete.
   *
   * ⚠️ **There is no physical foreign key from `folio_blobs.fileId` to
   * `files.id`**, whatever this file used to say. It claimed the delete
   * cascaded from the framework row down to the overlay; nothing did,
   * so every attachment deleted here left its `folio_blobs` row behind
   * pointing at a file that no longer existed. Adding the constraint
   * means a table rebuild, and a rebuild on D1 is the cascade-wipe this
   * app has already been bitten by once - see "Migration safety on D1"
   * in `apps/lore/CLAUDE.md`. The relationship is therefore logical, and
   * this method is what enforces it.
   *
   * The overlay goes first. The reverse order leaves, on a failure in
   * between, a row that resolves to nothing - which the folio renders as
   * a broken attachment. Losing the bytes and keeping nothing is the
   * better half of that trade.
   */
  public async delete(fileId: string): Promise<void> {
    const blob = await this.findById(fileId);
    if (!blob) throw new NotFoundError("Blob not found");

    await this.blobs.deleteById(fileId);

    // Checked rather than caught: the framework row may already be gone
    // (this is exactly the orphan state that existed before), and
    // `deleteFile` answers a missing row with a throw.
    const file = await this.frameworkFiles.findOne({
      where: { id: { eq: fileId } },
    });
    if (file) {
      await this.fileService.deleteFile(fileId);
    }
  }

  /**
   * Reclaim every attachment of a folio: the overlay rows, the framework
   * file rows, and the bytes behind them.
   *
   * Called BEFORE the folio row goes, and that ordering is the whole
   * point: `folio_blobs.folioId` cascades, so once the folio is deleted
   * the overlay rows are gone and with them the only record of which
   * files belonged to it. Deleting a folio used to leave its images in
   * the bucket forever, paid for and unreachable.
   *
   * Returns how many were reclaimed, which is what makes it assertable.
   */
  public async deleteByFolio(folioId: string): Promise<number> {
    const blobs = await this.blobs.findMany({
      where: { folioId: { eq: folioId } },
      columns: ["fileId"],
    });
    if (blobs.length === 0) return 0;

    const ids = blobs.map((blob) => blob.fileId);
    await this.blobs.deleteMany({ fileId: { inArray: ids } });
    // One round trip per bucket, and it tolerates ids whose file row has
    // already gone.
    await this.fileService.deleteFiles(ids);
    return ids.length;
  }
}

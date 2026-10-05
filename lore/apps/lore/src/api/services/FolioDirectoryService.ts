import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, DbEntityNotFoundError, sql } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import {
  type FolioDirectory,
  folioDirectories,
} from "../entities/folioDirectories.ts";
import { folios } from "../entities/folios.ts";
import { BestEffort } from "./BestEffort.ts";
import { BoundParameters } from "./BoundParameters.ts";
import { FolioAttachmentService } from "./FolioAttachmentService.ts";
import { FolioNameService } from "./FolioNameService.ts";
import { ResourceLinkService } from "./ResourceLinkService.ts";

/**
 * Create / rename / move / delete operations on folio directories,
 * with cycle detection and sibling-name uniqueness enforcement. Same
 * patterns the old folio-tree (#45) used, generalized to directories.
 *
 * Cycle handling: a directory's parent chain can't loop. We walk up
 * from the proposed parent and refuse if we ever land back on the
 * directory being moved. The chain bounds itself at the recorded
 * depth (`this.MAX_DEPTH`) — beyond that, the move is also refused so the
 * tree stays browseable.
 */
export class FolioDirectoryService {
  /**
   * Deepest directory nesting the tree accepts, which is also what bounds
   * the parent-chain walk that detects cycles.
   */
  protected readonly MAX_DEPTH = 8;
  protected readonly directories = $repository(folioDirectories);
  protected readonly folios = $repository(folios);
  protected readonly names = $inject(FolioNameService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly bound = $inject(BoundParameters);
  protected readonly linkService = $inject(ResourceLinkService);
  protected readonly attachmentService = $inject(FolioAttachmentService);
  protected readonly directoryShortId = $sequence();

  public async findById(id: string): Promise<FolioDirectory | undefined> {
    return this.directories.findOne({ where: { id: { eq: id } } });
  }

  public async findByShortId(
    projectId: number,
    shortId: number,
  ): Promise<FolioDirectory | undefined> {
    return this.directories.findOne({
      where: {
        projectId: { eq: projectId },
        shortId: { eq: shortId },
      },
    });
  }

  public async listChildren(
    projectId: number,
    parentId: string | undefined,
  ): Promise<FolioDirectory[]> {
    return this.directories.findMany({
      where: parentId
        ? { parentId: { eq: parentId } }
        : {
            projectId: { eq: projectId },
            parentId: { isNull: true },
          },
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  public async create(input: {
    projectId: number;
    name: string;
    parentId?: string;
  }): Promise<FolioDirectory> {
    if (input.parentId) {
      const parent = await this.findById(input.parentId);
      if (!parent || parent.projectId !== input.projectId) {
        throw new BadRequestError("Parent directory not found in this project");
      }
      const depth = await this.depthOf(parent.id);
      if (depth + 1 >= this.MAX_DEPTH) {
        throw new BadRequestError(
          `Directory nesting exceeds the limit (${this.MAX_DEPTH} levels)`,
        );
      }
    }

    // The name is claimed BEFORE the row, under an id generated here (the
    // same UUIDv7 the column would have made): with no transaction, a
    // reservation written after the insert could lose the race and leave a
    // committed directory with no reservation at all (#Q2548).
    const scope = this.scopeOf(input.projectId, input.parentId);
    const id = this.crypto.randomUUIDv7(this.dateTime.nowMillis());
    const name = await this.names.claim(input.name, "directory", id, scope);

    try {
      const shortId = await this.directoryShortId.next(String(input.projectId));
      return await this.directories.create({
        id,
        projectId: input.projectId,
        shortId,
        parentId: input.parentId,
        name,
      });
    } catch (error) {
      await this.bestEffort.run(
        "createDirectory: releasing the claimed name failed",
        () => this.names.releaseByEntity(id),
      );
      throw error;
    }
  }

  public async rename(id: string, name: string): Promise<FolioDirectory> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");
    const scope = this.scopeOf(directory.projectId, directory.parentId);
    // One UPDATE of the directory's own reservation row (#Q2550), not a
    // release then a reserve: with no transaction (D1), a reserve failing
    // after the release left the name unguarded. A collision answers 409
    // and the old name stays reserved.
    const nextName = await this.names.rename(id, "directory", name, scope);
    return this.directories.updateById(id, { name: nextName });
  }

  public async move(
    id: string,
    newParentId: string | undefined,
  ): Promise<FolioDirectory> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");
    if (newParentId === id) {
      throw new BadRequestError("A directory cannot be its own parent");
    }
    if (newParentId) {
      const newParent = await this.findById(newParentId);
      if (!newParent || newParent.projectId !== directory.projectId) {
        throw new BadRequestError("Target directory not found in this project");
      }
      // Cycle check: walk up from newParent — must NOT contain id.
      let cursor: string | undefined = newParentId;
      const seen = new Set<string>();
      let depth = 0;
      while (cursor) {
        if (cursor === id) {
          throw new BadRequestError(
            "Cannot move a directory under one of its own descendants",
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        depth += 1;
        const node: { parentId?: string } | undefined =
          await this.findById(cursor);
        if (!node?.parentId) break;
        cursor = node.parentId;
      }
      if (depth >= this.MAX_DEPTH) {
        throw new BadRequestError(
          `Directory nesting exceeds the limit (${this.MAX_DEPTH} levels)`,
        );
      }
    }
    const scope = this.scopeOf(directory.projectId, newParentId);
    // The name first, as in rename(): one UPDATE of the reservation row.
    const nextName = await this.names.rename(
      id,
      "directory",
      directory.name,
      scope,
    );

    // The cycle check above walks the tree one read per level, so two
    // opposite moves (A under B, B under A) both pass it. The UPDATE
    // re-checks it itself (#Q2550): it matches no row when the new parent
    // sits inside the moved subtree, found by walking up from the new
    // parent in the same statement.
    const t = this.directories.table;
    const col = (name: string) => sql.identifier(name);
    const guard = newParentId
      ? {
          notExists: sql`(
            WITH RECURSIVE ancestors(node_id, parent_ref) AS (
              SELECT ${col(t.id.name)}, ${col(t.parentId.name)} FROM ${t}
              WHERE ${col(t.id.name)} = ${newParentId}
              UNION ALL
              SELECT d.${col(t.id.name)}, d.${col(t.parentId.name)}
              FROM ${t} AS d JOIN ancestors AS a
                ON d.${col(t.id.name)} = a.parent_ref
            )
            SELECT 1 FROM ancestors WHERE node_id = ${id}
          )`,
        }
      : {};
    try {
      return await this.directories.updateOne(
        { id: { eq: id }, ...guard },
        {
          // `newParentId ?? null`, NOT `newParentId` bare — moving to the
          // project root passes `newParentId: undefined`, and an object key
          // present with value `undefined` is exactly what Drizzle's
          // `.set()` silently skips (same rule `FolioController.update`'s
          // own `directoryId` handling is built around, one file over:
          // `undefined` means "no change", only an explicit `null` clears a
          // nullable FK). Before this fix, a directory could never actually
          // be moved to root through this method — the request succeeded
          // and silently left `parentId` exactly as it was.
          parentId: newParentId ?? null,
          name: nextName,
        },
      );
    } catch (error) {
      if (!(error instanceof DbEntityNotFoundError)) throw error;
      // Refused by the guard: give the name back its old place.
      await this.bestEffort.run(
        "moveDirectory: restoring the previous name failed",
        () =>
          this.names.rename(
            id,
            "directory",
            directory.name,
            this.scopeOf(directory.projectId, directory.parentId),
          ),
      );
      throw new BadRequestError(
        "Cannot move a directory under one of its own descendants",
      );
    }
  }

  /**
   * Delete a directory. Refuses if not empty (folios + child dirs)
   * unless `cascade: true` - in which case we walk the subtree and
   * release every reservation explicitly before letting the FK CASCADE
   * wipe the rows. (`folio_names` has no FK to the entity tables on
   * purpose - it discriminates by `kind` - so it can't piggy-back on the
   * DB cascade. Explicit walk keeps the reservation table consistent.)
   *
   * Attachments are not counted and not walked. An attachment belongs to a
   * folio, not to a folder: the folder column they once carried was
   * dead since attachments became folio-scoped (dropped with #E74), so a
   * query on it always came back empty, and the release loop it fed had nothing to release -
   * attachments left the `folio_names` namespace in the same change. The
   * attachments of the folios below are reclaimed by the delete itself:
   * their rows with the other rows, their bytes last.
   */
  public async delete(id: string, opts?: { cascade?: boolean }): Promise<void> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");

    // The whole subtree is read first (#Q2550), so every write below knows
    // what it covers. Id lists go in batches under D1's 100 bound values.
    const directoryIds = [id];
    let frontier = [id];
    while (frontier.length > 0) {
      const children = await this.bound.collect(frontier, (batch) =>
        this.directories.findMany({
          where: { parentId: { inArray: batch } },
          columns: ["id"],
        }),
      );
      frontier = children.map((child) => child.id);
      directoryIds.push(...frontier);
    }
    const folioIds = (
      await this.bound.collect(directoryIds, (batch) =>
        this.folios.findMany({
          where: { directoryId: { inArray: batch } },
          columns: ["id"],
        }),
      )
    ).map((folio) => folio.id);

    const isEmpty = directoryIds.length === 1 && folioIds.length === 0;
    if (!isEmpty && !opts?.cascade) {
      throw new BadRequestError(
        "Directory is not empty. Pass cascade=true to delete recursively.",
      );
    }

    // Database rows first, storage last (#Q2550). With no transaction, a
    // failure partway used to leave surviving folios whose attachment
    // bytes were already gone. Now nothing leaves storage until every row
    // that pointed at it is deleted.
    const fileIds = await this.attachmentService.fileIdsOf(folioIds);
    // `folio_names` has no FK to the entity tables (it discriminates by
    // `kind`), so no cascade frees the names.
    for (const batch of this.bound.chunk([...folioIds, ...directoryIds])) {
      await this.names.releaseByEntities(batch);
    }
    // `folio_links.from_id` is no FK either: the outbound links of every
    // folio cascaded away are deleted here, or they outlive it. Inbound
    // links stay, as `FolioController.delete` leaves them: a reference to
    // a deleted folio is a broken link, which is what a reader should see.
    await this.linkService.deleteLinksFromMany("folio", folioIds);
    // And their filings: a deleted folio is filed under no epic (#Q2626).
    await this.linkService.unfileTargets("folio", folioIds);
    await this.attachmentService.deleteRowsOf(folioIds);
    // The FK cascade takes the child directories, the folios and their
    // revisions.
    await this.directories.deleteById(id);

    // The bytes, best effort: every row that referenced them is gone.
    await this.bestEffort.run("deleteDirectory: file cleanup failed", () =>
      this.attachmentService.deleteFiles(fileIds),
    );
  }

  /**
   * Depth of a directory — 0 for root-level, 1 for one parent up, etc.
   */
  protected async depthOf(directoryId: string): Promise<number> {
    let depth = 0;
    let cursor: string | undefined = directoryId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node: { parentId?: string } | undefined =
        await this.findById(cursor);
      const next = node?.parentId;
      if (!next) break;
      depth += 1;
      cursor = next;
    }
    return depth;
  }

  /**
   * Build the ScopeKey for the name-reservation table. Delegates so the
   * folio side and the directory side cannot drift apart on what a scope
   * key is.
   */
  public scopeOf(projectId: number, parentDirectoryId?: string) {
    return this.names.scopeOf(projectId, parentDirectoryId);
  }
}

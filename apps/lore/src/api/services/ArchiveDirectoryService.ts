import { $inject } from "alepha";
import { $repository, $sequence } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";
import { archiveBlobs } from "../entities/archiveBlobs.ts";
import {
  type ArchiveDirectory,
  archiveDirectories,
} from "../entities/archiveDirectories.ts";
import { folios } from "../entities/folios.ts";
import { ArchiveNameService } from "./ArchiveNameService.ts";

/**
 * Create / rename / move / delete operations on archive directories,
 * with cycle detection and sibling-name uniqueness enforcement. Same
 * patterns the old folio-tree (#45) used, generalized to directories.
 *
 * Cycle handling: a directory's parent chain can't loop. We walk up
 * from the proposed parent and refuse if we ever land back on the
 * directory being moved. The chain bounds itself at the recorded
 * depth (`MAX_DEPTH`) — beyond that, the move is also refused so the
 * tree stays browseable.
 */
const MAX_DEPTH = 8;

export class ArchiveDirectoryService {
  protected readonly directories = $repository(archiveDirectories);
  protected readonly folios = $repository(folios);
  protected readonly blobs = $repository(archiveBlobs);
  protected readonly names = $inject(ArchiveNameService);
  protected readonly directoryShortId = $sequence();

  public async findById(id: string): Promise<ArchiveDirectory | undefined> {
    return this.directories.findOne({ where: { id: { eq: id } } });
  }

  public async findByShortId(
    campaignId: number,
    shortId: number,
  ): Promise<ArchiveDirectory | undefined> {
    return this.directories.findOne({
      where: {
        campaignId: { eq: campaignId },
        shortId: { eq: shortId },
      },
    });
  }

  public async listChildren(
    campaignId: number,
    parentId: string | undefined,
  ): Promise<ArchiveDirectory[]> {
    return this.directories.findMany({
      where: parentId
        ? { parentId: { eq: parentId } }
        : {
            campaignId: { eq: campaignId },
            parentId: { isNull: true },
          },
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  public async create(input: {
    campaignId: number;
    name: string;
    parentId?: string;
  }): Promise<ArchiveDirectory> {
    if (input.parentId) {
      const parent = await this.findById(input.parentId);
      if (!parent || parent.campaignId !== input.campaignId) {
        throw new BadRequestError(
          "Parent directory not found in this campaign",
        );
      }
      const depth = await this.depthOf(parent.id);
      if (depth + 1 >= MAX_DEPTH) {
        throw new BadRequestError(
          `Directory nesting exceeds the limit (${MAX_DEPTH} levels)`,
        );
      }
    }

    const scope = this.scopeOf(input.campaignId, input.parentId);
    const name = await this.names.autoSuffix(input.name, scope);

    const shortId = await this.directoryShortId.next(String(input.campaignId));
    const directory = await this.directories.create({
      campaignId: input.campaignId,
      shortId,
      parentId: input.parentId,
      name,
    });
    await this.names.reserve(name, "directory", directory.id, scope);
    return directory;
  }

  public async rename(id: string, name: string): Promise<ArchiveDirectory> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");
    const scope = this.scopeOf(directory.campaignId, directory.parentId);
    // Release first: autoSuffix counts the entity's own current
    // reservation as a sibling otherwise — so "Abc" → "abc" (or any
    // same-name/case-variant rename in the same scope) would resolve
    // to "abc (1)". The enclosing controller is $transactional, so a
    // collision in reserve rolls back the release.
    await this.names.releaseByEntity(id);
    const nextName = await this.names.autoSuffix(name, scope);
    await this.names.reserve(nextName, "directory", id, scope);
    return this.directories.updateById(id, { name: nextName });
  }

  public async move(
    id: string,
    newParentId: string | undefined,
  ): Promise<ArchiveDirectory> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");
    if (newParentId === id) {
      throw new BadRequestError("A directory cannot be its own parent");
    }
    if (newParentId) {
      const newParent = await this.findById(newParentId);
      if (!newParent || newParent.campaignId !== directory.campaignId) {
        throw new BadRequestError(
          "Target directory not found in this campaign",
        );
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
      if (depth >= MAX_DEPTH) {
        throw new BadRequestError(
          `Directory nesting exceeds the limit (${MAX_DEPTH} levels)`,
        );
      }
    }
    const scope = this.scopeOf(directory.campaignId, newParentId);
    // Release first — see rename() above. Move-to-same-parent would
    // otherwise see the entity's own reservation as a collision.
    await this.names.releaseByEntity(id);
    const nextName = await this.names.autoSuffix(directory.name, scope);
    await this.names.reserve(nextName, "directory", id, scope);
    return this.directories.updateById(id, {
      parentId: newParentId,
      name: nextName,
    });
  }

  /**
   * Delete a directory. Refuses if not empty (folios + blobs + child
   * dirs) unless `cascade: true` — in which case we walk the subtree
   * and release every reservation explicitly before letting the FK
   * CASCADE wipe the rows. (`archive_names` has no FK to the entity
   * tables on purpose — it discriminates by `kind` — so it can't piggy-
   * back on the DB cascade. Explicit walk keeps the reservation table
   * consistent.)
   */
  public async delete(id: string, opts?: { cascade?: boolean }): Promise<void> {
    const directory = await this.findById(id);
    if (!directory) throw new NotFoundError("Directory not found");
    const [childDirs, childFolios, childBlobs] = await Promise.all([
      this.directories.findMany({
        where: { parentId: { eq: id } },
        columns: ["id"],
      }),
      this.folios.findMany({
        where: { directoryId: { eq: id } },
        columns: ["id"],
      }),
      this.blobs.findMany({
        where: { directoryId: { eq: id } },
        columns: ["fileId"],
      }),
    ]);
    const isEmpty =
      childDirs.length === 0 &&
      childFolios.length === 0 &&
      childBlobs.length === 0;
    if (!isEmpty && !opts?.cascade) {
      throw new BadRequestError(
        "Directory is not empty. Pass cascade=true to delete recursively.",
      );
    }
    if (!isEmpty) {
      // Recursive name-reservation cleanup before the FK cascade
      // wipes the entity rows.
      for (const child of childDirs) {
        await this.delete(child.id, { cascade: true });
      }
      for (const folio of childFolios) {
        await this.names.releaseByEntity(folio.id);
      }
      for (const blob of childBlobs) {
        await this.names.releaseByEntity(blob.fileId);
      }
    }
    await this.names.releaseByEntity(id);
    await this.directories.deleteById(id);
  }

  /** Depth of a directory — 0 for root-level, 1 for one parent up, etc. */
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

  /** Build the ScopeKey for the name-reservation table. */
  public scopeOf(campaignId: number, parentDirectoryId?: string) {
    return parentDirectoryId
      ? { parentDirectoryId }
      : { rootScope: String(campaignId) };
  }
}

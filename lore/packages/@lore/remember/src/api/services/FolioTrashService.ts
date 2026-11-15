import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type FolioDirectory,
  folioDirectories,
} from "../entities/folioDirectories.ts";
import { folios } from "../entities/folios.ts";
import { FolioDeletion } from "./FolioDeletion.ts";
import { FolioDirectoryService } from "./FolioDirectoryService.ts";

/**
 * The project's trash (#Q3659): one directory per project that Lore owns.
 *
 * - It always exists: {@link ensure} makes it on demand (the directory list
 *   asks for it on every read), and the nightly sweep makes it for every
 *   project, so existing projects get one without a data migration.
 * - A root directory a person named `trash` before this is ADOPTED as the
 *   trash rather than duplicated beside it.
 * - It cannot be renamed, moved or deleted (`FolioDirectoryService`
 *   refuses, for every surface).
 * - Moving a folio or a directory into it stamps `trashedAt`; moving it out
 *   clears it. {@link purge} deletes for good what has sat there 30 days.
 */
export class FolioTrashService {
  /**
   * How long an item stays in the trash before the purge deletes it.
   */
  public static readonly RETENTION_DAYS = 30;
  /**
   * The name a new trash gets.
   */
  public static readonly NAME = "Trash";

  protected readonly log = $logger();
  protected readonly directories = $repository(folioDirectories);
  protected readonly folios = $repository(folios);
  protected readonly directoryService = $inject(FolioDirectoryService);
  protected readonly deletion = $inject(FolioDeletion);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The project's trash, made or adopted if it has none yet.
   */
  public async ensure(projectId: number): Promise<FolioDirectory> {
    const held = await this.directories.findOne({
      where: { projectId: { eq: projectId }, system: { eq: "trash" } },
    });
    if (held) return held;

    // Adopt a root directory a person already called "trash".
    const roots = await this.directories.findMany({
      where: { projectId: { eq: projectId }, parentId: { isNull: true } },
    });
    const named = roots.find(
      (directory) =>
        directory.system === undefined &&
        directory.name.trim().toLowerCase() === "trash",
    );
    if (named) {
      return await this.directories.updateById(named.id, { system: "trash" });
    }

    const created = await this.directoryService.create({
      projectId,
      name: FolioTrashService.NAME,
    });
    return await this.directories.updateById(created.id, { system: "trash" });
  }

  /**
   * Whether `directoryId` is a project's trash.
   */
  public async isTrash(directoryId: string | undefined): Promise<boolean> {
    if (!directoryId) return false;
    const directory = await this.directories.findOne({
      where: { id: { eq: directoryId } },
    });
    return directory?.system === "trash";
  }

  /**
   * A folio's `trashedAt` once it sits in `directoryId`: kept when it was
   * already in the trash, stamped now when it arrives, cleared otherwise.
   */
  public async trashedAtFor(
    directoryId: string | undefined,
    current: string | undefined,
  ): Promise<string | null> {
    if (!(await this.isTrash(directoryId))) return null;
    return current ?? this.dateTime.nowISOString();
  }

  /**
   * Delete for good every folio and directory that has sat in a trash for
   * {@link RETENTION_DAYS} days. A directory goes with everything under it.
   */
  public async purge(): Promise<{ folios: number; directories: number }> {
    const cutoff = new Date(
      this.dateTime.nowMillis() -
        FolioTrashService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const staleFolios = await this.folios.findMany({
      where: { trashedAt: { lt: cutoff } },
      columns: ["id"],
    });
    for (const folio of staleFolios) {
      await this.deletion.delete(folio.id);
    }
    const staleDirectories = await this.directories.findMany({
      where: { trashedAt: { lt: cutoff } },
      columns: ["id"],
    });
    for (const directory of staleDirectories) {
      // Re-read: an earlier directory's cascade may have taken this one.
      if (!(await this.directoryService.findById(directory.id))) continue;
      await this.directoryService.delete(directory.id, { cascade: true });
    }
    if (staleFolios.length || staleDirectories.length) {
      this.log.info("emptied the folio trash", {
        folios: staleFolios.length,
        directories: staleDirectories.length,
      });
    }
    return { folios: staleFolios.length, directories: staleDirectories.length };
  }
}

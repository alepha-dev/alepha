import { ResourceLinkService } from "@lore/core/api";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { folioDirectories } from "../entities/folioDirectories.ts";
import { type Folio, folios } from "../entities/folios.ts";
import { FolioDeletion } from "./FolioDeletion.ts";
import { FolioNameService } from "./FolioNameService.ts";

/**
 * Deleted folios (#Q3698), where the Trash directory used to be (#Q3659).
 *
 * Deleting a folio stamps its `deletedAt` (`db.deletedAt()`), which hides it
 * from every repository read; its outbound links go, so it is in nobody's
 * backlinks, and its name is released, so the title is free. For
 * {@link RETENTION_DAYS} days it is listed in Folio > Recently deleted and
 * can be restored there, links and name back; then {@link purge} deletes it
 * for good, files and history with it.
 */
export class FolioRecentlyDeleted {
  /**
   * How long a deleted folio can be restored before the purge takes it.
   */
  public static readonly RETENTION_DAYS = 30;

  protected readonly log = $logger();
  protected readonly folios = $repository(folios);
  protected readonly directories = $repository(folioDirectories);
  protected readonly deletion = $inject(FolioDeletion);
  protected readonly names = $inject(FolioNameService);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Soft-delete a folio: hidden everywhere, recoverable for 30 days.
   */
  public async delete(id: string): Promise<void> {
    await this.links.deleteLinksFrom({ kind: "folio", id });
    await this.names.releaseByEntity(id);
    await this.folios.deleteById(id);
  }

  /**
   * A project's deleted folios, most recent first.
   */
  public async list(projectId: number): Promise<Folio[]> {
    return await this.folios.findMany(
      {
        where: { projectId: { eq: projectId }, deletedAt: { isNotNull: true } },
        orderBy: [{ column: "deletedAt", direction: "desc" }],
      },
      { force: true },
    );
  }

  /**
   * A deleted folio of the project, or a 404.
   */
  public async findDeleted(projectId: number, id: string): Promise<Folio> {
    const folio = await this.folios.findOne(
      {
        where: {
          id: { eq: id },
          projectId: { eq: projectId },
          deletedAt: { isNotNull: true },
        },
      },
      { force: true },
    );
    if (!folio) throw new NotFoundError("No deleted folio with this id.");
    return folio;
  }

  /**
   * Bring a deleted folio back where it was, or at the root when its
   * directory is gone: its name claimed again (suffixed when taken since)
   * and its outbound links rebuilt from its content.
   */
  public async restore(projectId: number, id: string): Promise<Folio> {
    const folio = await this.findDeleted(projectId, id);
    const directory = folio.directoryId
      ? await this.directories.findOne({
          where: { id: { eq: folio.directoryId } },
        })
      : undefined;
    const directoryId = directory?.id;
    const title = await this.names.claim(
      folio.title,
      "folio",
      folio.id,
      this.names.scopeOf(projectId, directoryId),
    );
    const restored = await this.folios.updateById(
      folio.id,
      {
        deletedAt: null as never,
        title,
        directoryId: (directoryId ?? null) as never,
      },
      { force: true },
    );
    if (!restored.protected) {
      await this.links.syncLinks(
        { kind: "folio", id: restored.id, projectId },
        restored.content,
      );
    }
    return restored;
  }

  /**
   * Delete a deleted folio for good, before its 30 days are up.
   */
  public async deletePermanently(projectId: number, id: string): Promise<void> {
    await this.findDeleted(projectId, id);
    await this.deletion.delete(id);
  }

  /**
   * Delete for good every folio deleted more than {@link RETENTION_DAYS}
   * days ago.
   */
  public async purge(): Promise<number> {
    const cutoff = new Date(
      this.dateTime.nowMillis() -
        FolioRecentlyDeleted.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const stale = await this.folios.findMany(
      { where: { deletedAt: { lt: cutoff } }, columns: ["id"] },
      { force: true },
    );
    for (const folio of stale) await this.deletion.delete(folio.id);
    if (stale.length) {
      this.log.info("purged deleted folios", { folios: stale.length });
    }
    return stale.length;
  }
}

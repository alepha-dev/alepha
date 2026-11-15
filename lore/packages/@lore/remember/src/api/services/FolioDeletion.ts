import { ResourceLinkService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folios } from "../entities/folios.ts";
import { FolioAttachmentService } from "./FolioAttachmentService.ts";
import { FolioNameService } from "./FolioNameService.ts";

/**
 * Deletes one folio and what hangs off it that no foreign key cascades:
 * its outbound links, its epic filing, its attachments' bytes and its name.
 *
 * Out of `FolioController.delete` (#Q3659), so the trash's purge deletes a
 * folio the same way a person does. The audit and the activity line stay
 * the controller's: a purge has no person to log.
 */
export class FolioDeletion {
  protected readonly folios = $repository(folios);
  protected readonly linkService = $inject(ResourceLinkService);
  protected readonly attachmentService = $inject(FolioAttachmentService);
  protected readonly nameService = $inject(FolioNameService);

  public async delete(id: string): Promise<void> {
    // ⚠️ `folio_links` does NOT cascade: `from_id` stopped being a foreign
    // key when links became polymorphic, so its outbound rows are deleted
    // here. Inbound rows are deliberately left: a link to a folio that no
    // longer exists is a broken reference the reader renders as such.
    await this.linkService.deleteLinksFrom({ kind: "folio", id });
    // And its filing: a deleted folio is filed under no epic (#Q2626).
    await this.linkService.unfileTargets("folio", [id]);
    // Before the row: `folio_blobs.folioId` cascades, and with it the only
    // record of which files, and which bytes, belonged to it.
    await this.attachmentService.deleteByFolio(id);
    // `folio_names` has no foreign key to `folios`: the reservation would
    // outlive the folio and block the name forever.
    await this.nameService.releaseByEntity(id);
    // `force`: `folios` is soft-deleted (#Q3698), so a plain delete would
    // only stamp `deletedAt`. This is the purge: the row goes.
    //
    // `deleteMany`, not `deleteById`: two purges can race for one row (the
    // nightly job and a person, or two isolates), and the second finding it
    // gone has nothing left to do, so it must not throw.
    await this.folios.deleteMany({ id: { eq: id } }, { force: true });
  }
}

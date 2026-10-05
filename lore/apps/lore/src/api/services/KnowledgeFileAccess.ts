import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folioAttachments } from "../entities/folioAttachments.ts";
import { FileAccessRegistry } from "./FileAccessRegistry.ts";

/**
 * Who may read a folio attachment, registered on core's `FileAccessRegistry`
 * (#E75, #Q2623): any project member who reads folios (Drive-style sharing
 * scope per folio #4 Q2). The attachment row holds the project id.
 */
export class KnowledgeFileAccess {
  /**
   * Bucket value stays "archive-blobs": see the note on
   * `FOLIO_ATTACHMENT_BUCKET` in `FolioAttachmentService.ts`.
   */
  public static readonly FOLIO_ATTACHMENT_BUCKET = "archive-blobs";

  protected readonly registry = $inject(FileAccessRegistry);
  protected readonly folioAttachments = $repository(folioAttachments);

  constructor() {
    this.registry.register(
      KnowledgeFileAccess.FOLIO_ATTACHMENT_BUCKET,
      async (fileId) => {
        const attachment = await this.folioAttachments.findOne({
          where: { fileId: { eq: fileId } },
        });
        return attachment
          ? { projectId: attachment.projectId, permission: "folio:read" }
          : undefined;
      },
    );
  }
}

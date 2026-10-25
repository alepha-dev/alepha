import type { UserAccountToken } from "alepha/security";
import { ForbiddenError, NotFoundError } from "alepha/server";

import type { FileEntity } from "../entities/files.ts";

/**
 * Authorization policy for file reads served through `FileController.streamFile`.
 *
 * Default: the caller must be the uploader (`file.creator === user.id`). Any
 * other access path - public buckets, shared attachments, avatars - must be
 * opted in by overriding this provider in the consuming app:
 *
 * ```ts
 * class MyAccess extends FileAccessProvider {
 *   async assertReadable(file, user) {
 *     if (file.bucket === "avatars") return; // public
 *     if (file.bucket === "campaign-icons") return this.checkCampaignVisible(file, user);
 *     return super.assertReadable(file, user);
 *   }
 * }
 * Alepha.create().with({ provide: FileAccessProvider, use: MyAccess });
 * ```
 *
 * Why this exists: prior to introducing this gate, `streamFile` only required
 * the framework-wide `file:read` permission. The default `user` role grants
 * `*`, so every authenticated user could download any file by UUID - turning
 * the 128-bit id into the sole security boundary across tenants.
 */
export class FileAccessProvider {
  /**
   * Throws `ForbiddenError` when `user` may not read `file`. Override to
   * implement bucket-aware or relationship-aware policies. The default
   * implementation is strict: only the uploader passes.
   */
  async assertReadable(
    file: FileEntity,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenError("File access requires authentication");
    }
    // Privileged identities (admin without narrow ownership scope) bypass
    // the per-file check — they need to be able to read any file via the
    // admin UI/inspector regardless of who uploaded it.
    if (user.ownership === false) {
      return;
    }
    if (file.creator && file.creator === user.id) {
      return;
    }
    throw new ForbiddenError("File access denied");
  }

  /**
   * Throws when `file` may not be served through the anonymous
   * `/public/files/:id` route. The default is deny-all: nothing is public
   * unless this method is overridden. Throws `NotFoundError` (not 403) so the
   * endpoint doesn't leak the existence of private file ids.
   *
   * Typical override matches on bucket name:
   *
   * ```ts
   * class MyAccess extends FileAccessProvider {
   *   async assertPublic(file) {
   *     if (file.bucket === "avatars") return;
   *     if (file.bucket === "campaign-icons") return;
   *     return super.assertPublic(file);
   *   }
   * }
   * ```
   */
  async assertPublic(file: FileEntity): Promise<void> {
    throw new NotFoundError(`File '${file.id}' not found`);
  }
}

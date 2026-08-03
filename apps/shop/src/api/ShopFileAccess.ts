import type { FileEntity } from "alepha/api/files";
import { FileAccessProvider } from "alepha/api/files";

/**
 * Which files anonymous visitors may fetch.
 *
 * `FileAccessProvider` denies everything by default, so the first run of this
 * shop served six 404s for its own catalogue drawings — which is the framework
 * being right: a storage bucket becomes public because someone said so, never
 * because a URL was guessable.
 *
 * Only the `pieces` bucket is opened, and only that one: an invoice PDF or a
 * customer's upload landing in the same table must stay unreachable.
 */
export class ShopFileAccess extends FileAccessProvider {
  override async assertPublic(file: FileEntity): Promise<void> {
    if (file.bucket === "pieces") {
      return;
    }
    // Everything else keeps the default deny, which answers 404 rather than 403
    // so the endpoint does not confirm that a private file exists.
    return super.assertPublic(file);
  }
}

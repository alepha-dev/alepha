import { $storage } from "alepha/api/files";

/**
 * File storage owned by the users module.
 *
 * A module variant: `$realm` registers it for a realm with
 * `features: { avatars: true }`.
 */
export class UserStorage {
  /**
   * Avatars / profile pictures.
   *
   * `maxSize` is in **megabytes**. This used to read `5 * 1024 * 1024`,
   * which set the cap to five million megabytes, i.e. no cap at all.
   */
  public readonly avatars = $storage({
    name: "avatars",
    description: "User avatars and profile pictures",
    maxSize: 5,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
}

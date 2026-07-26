import { $storage } from "alepha/api/files";

/**
 * File storage owned by the users module.
 *
 * Declared as a module variant — not auto-injected. It is instantiated
 * lazily the first time something calls `alepha.inject(UserStorage)`.
 */
export class UserStorage {
  /**
   * Avatars / profile pictures.
   *
   * `maxSize` is in **megabytes**. This used to read `5 * 1024 * 1024`,
   * which set the cap to five million megabytes — i.e. no cap at all.
   */
  public readonly avatars = $storage({
    name: "avatars",
    description: "User avatars and profile pictures",
    maxSize: 5,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
}

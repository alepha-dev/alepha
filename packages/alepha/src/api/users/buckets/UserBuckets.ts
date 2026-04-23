import { $bucket } from "alepha/bucket";

/**
 * User-specific file storage wrapper service.
 *
 * This service provides file storage for user-related files such as:
 * - User avatars/profile pictures
 *
 * Declared as a module variant — not auto-injected. It is instantiated
 * lazily the first time something calls `alepha.inject(UserBuckets)`.
 */
export class UserBuckets {
  /**
   * Bucket for user avatar storage.
   */
  public readonly avatars = $bucket({
    maxSize: 5 * 1024 * 1024, // 5 MB
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
}

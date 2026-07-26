import { $storage } from "../primitives/$storage.ts";
import { DEFAULT_STORAGE } from "../services/FileService.ts";

/**
 * The `default` storage.
 *
 * Exists so `POST /api/files` works without a `bucket` field, and so
 * `FileService.storage()` always resolves something. Applications are
 * expected to declare their own named `$storage` instances rather than
 * pile everything in here.
 */
export class DefaultStorage {
  public readonly files = $storage({ name: DEFAULT_STORAGE });
}

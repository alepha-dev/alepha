import { $atom, type Infer, z } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Configuration of `alepha/api/files` as a whole.
 *
 * Each `$storage` declares its own limits (`maxSize`, `mimeTypes`), and those
 * are about one file. What lives here is about all of them together.
 *
 * `maxTotalSize` is seeded from the `FILES_MAX_TOTAL_SIZE` environment
 * variable when the host sets it, see `FileService`. Absent both, it is
 * {@link DEFAULT_MAX_TOTAL_SIZE}.
 */
/**
 * The default total quota, in megabytes: 10 GB.
 */
export const DEFAULT_MAX_TOTAL_SIZE = 10 * 1024;

/**
 * The default per-user quota, in megabytes: 1 GB.
 */
export const DEFAULT_MAX_USER_SIZE = 1024;

export const filesOptions = $atom({
  name: "alepha.api.files.options",
  schema: z.object({
    /**
     * The most all stored files may add up to, in **megabytes**, every
     * storage together. `0` means unlimited.
     *
     * An upload that would take the total past it is refused with
     * `FileTooLargeError` (413). Rows past their expiry still count until the
     * purge job removes them, because their blobs still take the space.
     *
     * ⚠️ **10 GB by default, where it used to be unlimited.** An application
     * that stores files has a bill for them, and a default of "as much as
     * anyone uploads" is the one setting whose failure mode nobody sees until
     * it is expensive. 10 GB is far above what an app reaches by accident and
     * well under a surprise. Raise it, or set `0` to opt out, and the
     * environment wins over both (see `FILES_MAX_TOTAL_SIZE`).
     */
    maxTotalSize: z
      .number()
      .min(0)
      .describe(
        "Most megabytes all stored files may add up to, every storage together. 0 is unlimited.",
      )
      .default(DEFAULT_MAX_TOTAL_SIZE),
    /**
     * The most one user's uploads may add up to, in **megabytes**, every
     * storage together. `0` means unlimited.
     *
     * Counted over the rows the user created (`files.creator`). An upload
     * with no user, from a job or a server-side call, is held to
     * `maxTotalSize` only.
     *
     * ⚠️ **Why there is one at all.** `maxTotalSize` is shared: without a
     * per-user cap, one account that holds `file:create` (every signed-in
     * user, in an app with open registration) fills it and every other
     * upload in the app answers 413. 1 GB by default; the environment wins
     * (see `FILES_MAX_USER_SIZE`).
     */
    maxUserSize: z
      .number()
      .min(0)
      .describe(
        "Most megabytes the uploads of one user may add up to, every storage together. 0 is unlimited.",
      )
      .default(DEFAULT_MAX_USER_SIZE),
  }),
  default: {
    maxTotalSize: DEFAULT_MAX_TOTAL_SIZE,
    maxUserSize: DEFAULT_MAX_USER_SIZE,
  },
  serverOnly: true,
});

export type FilesOptions = Infer<typeof filesOptions.schema>;

declare module "alepha" {
  interface State {
    [filesOptions.key]: FilesOptions;
  }
}

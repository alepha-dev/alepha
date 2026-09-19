import { $atom, type Infer, z } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Configuration of `alepha/api/files` as a whole.
 *
 * Each `$storage` declares its own limits (`maxSize`, `mimeTypes`), and those
 * are about one file. What lives here is about all of them together.
 *
 * `maxTotalSize` is seeded from the `FILES_MAX_TOTAL_SIZE` environment
 * variable when the host sets it, see `FileService`.
 */
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
     */
    maxTotalSize: z
      .number()
      .min(0)
      .describe(
        "Most megabytes all stored files may add up to, every storage together. 0 is unlimited.",
      )
      .default(0),
  }),
  default: {
    maxTotalSize: 0,
  },
  serverOnly: true,
});

export type FilesOptions = Infer<typeof filesOptions.schema>;

declare module "alepha" {
  interface State {
    [filesOptions.key]: FilesOptions;
  }
}

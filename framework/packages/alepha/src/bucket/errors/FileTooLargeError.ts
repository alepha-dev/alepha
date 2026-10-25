import { InvalidFileError } from "./InvalidFileError.ts";

/**
 * An upload past the bucket's size limit.
 */
export const FileTooLargeError = InvalidFileError.extend({
  name: "FILE_TOO_LARGE",
  default: { status: 413 },
  message: "File too large",
});

export type FileTooLargeError = InstanceType<typeof FileTooLargeError>;

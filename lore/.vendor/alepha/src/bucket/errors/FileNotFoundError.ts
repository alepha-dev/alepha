import { HttpError } from "alepha/server";

/**
 * A file the storage provider does not hold.
 */
export const FileNotFoundError = HttpError.extend({
  name: "FILE_NOT_FOUND",
  default: { status: 404 },
  message: "File not found",
});

export type FileNotFoundError = InstanceType<typeof FileNotFoundError>;

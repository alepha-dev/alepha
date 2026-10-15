import { HttpError } from "alepha/server";

/**
 * An upload the bucket refuses: a type it does not accept, an empty file.
 */
export const InvalidFileError = HttpError.extend({
  name: "INVALID_FILE",
  default: { status: 400 },
  message: "Invalid file",
});

export type InvalidFileError = InstanceType<typeof InvalidFileError>;

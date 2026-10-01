import { InvalidFileError } from "./InvalidFileError.ts";

/**
 * A file the storage would accept, were it smaller.
 *
 * A subclass rather than a status on {@link InvalidFileError}, because the two
 * refusals are not the same answer: a disallowed MIME type is a request that
 * will never work, while this one is a request that would have worked under a
 * limit. `413` says exactly that, and it is the status the transport layer
 * already answers for the same condition — the size cap it enforces before the
 * bytes ever reach a bucket.
 *
 * Still an `InvalidFileError`, so every existing `catch` and every test that
 * asks for one keeps working.
 */
export class FileTooLargeError extends InvalidFileError {
  public readonly status = 413;
}

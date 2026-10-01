import { AlephaError } from "alepha";

export class InvalidFileError extends AlephaError {
  /**
   * Typed `number`, not the literal `400`, so a subclass can answer something
   * else — {@link FileTooLargeError} answers `413`.
   */
  public readonly status: number = 400;
}

import { AlephaError } from "alepha";

export class InvalidFileError extends AlephaError {
  public readonly status = 400;
}

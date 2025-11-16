import { AlephaError } from "alepha";

export class FileNotFoundError extends AlephaError {
  public readonly status = 404;
}

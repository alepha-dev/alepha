import { AlephaError } from "@alepha/core";

export class FileNotFoundError extends AlephaError {
  public readonly status = 404;
}

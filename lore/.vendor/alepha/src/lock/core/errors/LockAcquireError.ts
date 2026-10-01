import { AlephaError } from "alepha";

export class LockAcquireError extends AlephaError {
  constructor(name: string) {
    super(`$lock: could not acquire lock '${name}'`);
  }
}

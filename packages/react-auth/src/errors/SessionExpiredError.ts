import { AlephaError } from "@alepha/core";

export class SessionExpiredError extends AlephaError {
  readonly name = "SessionExpiredError";
  readonly status = 401;
}

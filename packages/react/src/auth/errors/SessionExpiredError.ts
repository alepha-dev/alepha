import { AlephaError } from "alepha";

export class SessionExpiredError extends AlephaError {
  readonly name = "SessionExpiredError";
  readonly status = 401;
}

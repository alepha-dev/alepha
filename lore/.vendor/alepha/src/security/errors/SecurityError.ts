import { AlephaError } from "alepha";

export class SecurityError extends AlephaError {
  public override readonly name: string = "SecurityError";
  public readonly status = 403;
}

import { AlephaError } from "alepha";

export class BillingError extends AlephaError {
  public readonly status = 400;
}

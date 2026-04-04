import { AlephaError } from "alepha";

export class PaymentError extends AlephaError {
  public readonly status = 400;
}

import { AlephaError } from "alepha";
/**
 * A transition exhausted its definite compare-and-set conflict attempts.
 */
export class ActorContentionError extends AlephaError {
  override name = "ActorContentionError";
}

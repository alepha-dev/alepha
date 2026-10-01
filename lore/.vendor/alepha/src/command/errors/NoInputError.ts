import { UsageError } from "./UsageError.ts";

/**
 * A question was asked but there is nobody to answer: stdin reached EOF.
 *
 * Its own class, and not a plain `AlephaError`, because `Asker` retries on
 * `AlephaError` — that is how a failed validation re-asks the question. An EOF
 * that took part in that loop would re-ask forever against a stream that can
 * never answer, so this one has to be recognisable and escape.
 *
 * A {@link UsageError} rather than a sibling of it: reaching this means the
 * command was invoked in a way that cannot work, and the fix is on the caller's
 * side — pass the value as a flag or an argument. That also gets it the usage
 * rendering, instead of a stack trace wrapped in "Alepha failed to start".
 */
export class NoInputError extends UsageError {
  name = "NoInputError";
}

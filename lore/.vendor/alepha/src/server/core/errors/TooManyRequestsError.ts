import { HttpError } from "./HttpError.ts";

/**
 * The caller exceeded a rate limit.
 */
export const TooManyRequestsError = HttpError.extend({
  name: "TOO_MANY_REQUESTS",
  default: { status: 429 },
  message: "Too Many Requests",
});

export type TooManyRequestsError = InstanceType<typeof TooManyRequestsError>;

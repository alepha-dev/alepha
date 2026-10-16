import { HttpError } from "./HttpError.ts";

/**
 * The server cannot answer now; the caller may retry.
 */
export const ServiceUnavailableError = HttpError.extend({
  name: "SERVICE_UNAVAILABLE",
  default: { status: 503 },
  message: "Service Unavailable",
});

export type ServiceUnavailableError = InstanceType<
  typeof ServiceUnavailableError
>;

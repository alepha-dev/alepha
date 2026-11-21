import { TooManyRequestsError } from "alepha/server";

/**
 * A caller submitted too many refused codes and is told to wait. Not a
 * verdict on the code it just sent, which was not looked at: a flow that
 * turns every refusal into "invalid code" lets this one through.
 */
export const VerificationThrottledError = TooManyRequestsError.extend({
  name: "VERIFICATION_THROTTLED",
  message: "Too many refused codes, please try again later",
});

export type VerificationThrottledError = InstanceType<
  typeof VerificationThrottledError
>;

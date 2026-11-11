import { UnauthorizedError } from "alepha/server";

/**
 * A passkey sign-in that did not go through, whatever the reason: an
 * unknown or another realm's credential, a bad signature, a wrong origin, a
 * missing or expired challenge, a disabled account, a realm with passkeys
 * off, or an exhausted attempt budget.
 *
 * One error and one message for all of them, on purpose: a caller must not
 * learn which accounts exist or which check failed. The reason goes to the
 * server log and the audit.
 */
export const InvalidPasskeyError = UnauthorizedError.extend({
  name: "INVALID_PASSKEY",
  message: "That passkey could not sign you in",
});

export type InvalidPasskeyError = InstanceType<typeof InvalidPasskeyError>;

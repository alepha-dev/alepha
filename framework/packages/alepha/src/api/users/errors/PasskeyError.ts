import { z } from "alepha";
import { BadRequestError, ConflictError } from "alepha/server";

/**
 * Enrolment refused: the realm's `passkeys` setting is `"disabled"`.
 * Listing and removing stay available.
 */
export const PasskeysDisabledError = BadRequestError.extend({
  name: "PASSKEYS_DISABLED",
  message: "Passkeys are not available on this realm",
});

export type PasskeysDisabledError = InstanceType<typeof PasskeysDisabledError>;

/**
 * The account already holds as many passkeys as a user may.
 */
export const PasskeyLimitError = BadRequestError.extend({
  name: "PASSKEY_LIMIT",
  schema: z.object({ max: z.integer() }),
  message: (data) =>
    `An account holds at most ${data.max} passkeys. Remove one before adding another.`,
});

export type PasskeyLimitError = InstanceType<typeof PasskeyLimitError>;

/**
 * This credential is already enrolled, on this account or another.
 */
export const PasskeyConflictError = ConflictError.extend({
  name: "PASSKEY_CONFLICT",
  message: "This passkey is already registered",
});

export type PasskeyConflictError = InstanceType<typeof PasskeyConflictError>;

/**
 * The ceremony's challenge is missing, expired, already used, or was
 * issued for another ceremony or account. Start again from its options.
 */
export const PasskeyChallengeError = BadRequestError.extend({
  name: "PASSKEY_CHALLENGE",
  message: "This passkey request has expired. Try again.",
});

export type PasskeyChallengeError = InstanceType<typeof PasskeyChallengeError>;

/**
 * The current password was missing or wrong, on an account that has one.
 * The caller only ever asks about their own account, so saying which proof
 * failed discloses nothing.
 */
export const PasskeyPasswordProofError = BadRequestError.extend({
  name: "PASSKEY_PASSWORD_PROOF",
  schema: z.object({ reason: z.enum(["missing", "invalid"]) }),
  message: (data) =>
    data.reason === "missing"
      ? "Enter your current password to continue"
      : "Current password is incorrect",
});

export type PasskeyPasswordProofError = InstanceType<
  typeof PasskeyPasswordProofError
>;

/**
 * The confirmation with an existing passkey was missing, not user-verified,
 * from a passkey of another account, or did not verify.
 */
export const PasskeyAssertionProofError = BadRequestError.extend({
  name: "PASSKEY_ASSERTION_PROOF",
  schema: z.object({ reason: z.enum(["missing", "invalid"]) }),
  message: (data) =>
    data.reason === "missing"
      ? "Confirm with one of your passkeys to continue"
      : "That passkey could not confirm it is you",
});

export type PasskeyAssertionProofError = InstanceType<
  typeof PasskeyAssertionProofError
>;

/**
 * Removing this passkey would leave the account with no way to sign in.
 */
export const LastSignInMethodError = BadRequestError.extend({
  name: "LAST_SIGN_IN_METHOD",
  message:
    "This is the only way to sign in to this account. Add another before removing it.",
});

export type LastSignInMethodError = InstanceType<typeof LastSignInMethodError>;

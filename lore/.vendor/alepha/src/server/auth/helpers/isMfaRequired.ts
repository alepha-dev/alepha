import type { SecondFactorMethod } from "../schemas/secondFactorMethodSchema.ts";

/**
 * What a second-factor challenge tells the client.
 */
export interface MfaChallenge {
  /**
   * Opaque, signed, short-lived proof that the primary credential passed.
   * It grants nothing on its own.
   */
  challenge: string;

  /**
   * Which factors will clear it.
   */
  methods: SecondFactorMethod[];

  /**
   * Masked destination, for a factor whose code was sent somewhere.
   */
  sentTo?: string;
}

/**
 * Narrow a failed sign-in to "the password was right, but a second factor is
 * owed".
 *
 * Deliberately duck-typed rather than an `instanceof` check: the error the
 * browser sees is rebuilt by `HttpClient` from the response body, so it is a
 * plain `HttpError` and never the `MfaRequiredError` instance the server
 * threw.
 */
export const isMfaRequired = (
  error: unknown,
): error is { data: MfaChallenge } => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { error?: unknown; data?: unknown };
  if (candidate.error !== "MfaRequiredError") {
    return false;
  }

  const data = candidate.data as MfaChallenge | undefined;
  return typeof data?.challenge === "string" && Array.isArray(data.methods);
};

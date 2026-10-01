import { HttpError } from "alepha/server";

import type { SecondFactorMethod } from "../schemas/secondFactorMethodSchema.ts";

/**
 * Raised when the primary credential checked out but the realm wants a
 * second factor before it hands over a session.
 *
 * Deliberately a 401 carrying structured `data` rather than a 200 with a
 * different body: the token route keeps its exact response contract, so no
 * existing client breaks, and a caller branches on `error === "MfaRequiredError"`
 * the same way it already branches on `InvalidCredentialsError`.
 *
 * The `challenge` is a signed, short-lived assertion that the password was
 * verified. It grants nothing on its own.
 */
export class MfaRequiredError extends HttpError {
  constructor(data: {
    challenge: string;
    methods: SecondFactorMethod[];
    sentTo?: string;
  }) {
    super({
      status: 401,
      message: "A second authentication factor is required",
      data,
    });
  }
}

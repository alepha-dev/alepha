import { $inject, Alepha, z } from "alepha";
import { $rateLimit } from "alepha/rate-limit";
import {
  $action,
  BadRequestError,
  HttpError,
  NotFoundError,
} from "alepha/server";

import { validateVerificationCodeResponseSchema } from "../schemas/validateVerificationCodeResponseSchema.ts";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";
import { VerificationService } from "../services/VerificationService.ts";

export class VerificationController {
  protected readonly alepha = $inject(Alepha);
  protected readonly verificationService = $inject(VerificationService);

  public readonly url = "/verifications";
  public readonly group = "verifications";

  /**
   * Refused submissions one caller may make before the route stops answering
   * it, counted by client address. An accepted code gives its slot back.
   *
   * The entry's own attempt budget is per target, and the target comes from
   * the body: without a count per caller, one caller could spend the budget
   * of every address it can name.
   */
  protected readonly refusals = $rateLimit({
    name: "verifications:validate",
    limit: 10,
    window: [15, "minutes"],
  });

  // SECURITY: there is deliberately NO public "request a code" action here.
  // `VerificationService.createVerification` returns the raw token so that the
  // *caller* can deliver it out-of-band (email/SMS). Exposing that over HTTP
  // let anyone request a code for any target and read it straight from the
  // response, defeating verification entirely. Verification requests are
  // driven server-side (RegistrationService / UserService call the service
  // directly and send the code); only code *submission* is public, below.
  //
  // The submission answers every refusal alike: no entry, a wrong code, an
  // expired or a locked one. Told apart, they say which addresses and phone
  // numbers have a verification pending.
  public readonly validateVerificationCode = $action({
    path: `${this.url}/:type/validate`,
    group: this.group,
    method: "POST",
    schema: {
      params: z.object({
        type: verificationTypeEnumSchema,
      }),
      body: z.object({
        target: z.text(),
        token: z.text({
          description:
            "The verification token: a numeric code, or a UUID for link-based verification.",
        }),
      }),
      response: validateVerificationCodeResponseSchema,
    },
    handler: async ({ body, params }) => {
      // No request at all is a call from inside the process (a job, a
      // script): nobody to count. A request with no address is counted in
      // one shared bucket rather than let through.
      const request = this.alepha.store.get("alepha.http.request");
      const attempt = request
        ? await this.refusals.consume(`ip:${request.ip ?? "unknown"}`)
        : undefined;
      if (attempt && !attempt.allowed) {
        if (attempt.reason === "store") {
          throw new HttpError(
            { status: 503 },
            { message: "Verification is temporarily unavailable" },
          );
        }
        throw new HttpError(
          { status: 429 },
          { message: "Too many refused codes, please try again later" },
        );
      }

      try {
        const result = await this.verificationService.verifyCode(
          {
            type: params.type,
            target: body.target,
          },
          body.token,
        );
        if (attempt?.ticket) await this.refusals.refund(attempt.ticket);
        return result;
      } catch (error) {
        if (
          error instanceof BadRequestError ||
          error instanceof NotFoundError
        ) {
          throw new BadRequestError("Invalid or expired verification code");
        }
        throw error;
      }
    },
  });
}

import { $inject, Alepha, z } from "alepha";
import { $rateLimit, type RateLimitResult } from "alepha/rate-limit";
import {
  $action,
  BadRequestError,
  HttpError,
  NotFoundError,
} from "alepha/server";

import { VerificationThrottledError } from "../errors/VerificationThrottledError.ts";
import { validateVerificationCodeResponseSchema } from "../schemas/validateVerificationCodeResponseSchema.ts";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";
import { VerificationService } from "../services/VerificationService.ts";

export class VerificationController {
  protected readonly alepha = $inject(Alepha);
  protected readonly verificationService = $inject(VerificationService);

  public readonly url = "/verifications";
  public readonly group = "verifications";

  /**
   * Refused submissions one address may make for one target before the route
   * stops answering it for that target. An accepted code gives its slot
   * back.
   *
   * Per address AND target, because an address is rarely one person (a NAT,
   * a corporate proxy, a reverse proxy that forwards no client address): a
   * user mistyping their own code must not shut the route for everybody
   * behind the same address.
   */
  protected readonly refusals = $rateLimit({
    name: "verifications:validate",
    limit: 10,
    window: [15, "minutes"],
  });

  /**
   * Refused submissions one address may make across every target: the bound
   * on a caller walking through targets, which the limiter above cannot see.
   * High enough that a shared address does not meet it by accident.
   */
  protected readonly addressRefusals = $rateLimit({
    name: "verifications:validate:address",
    limit: 100,
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
      const address = `ip:${request?.ip ?? "unknown"}`;
      const attempts = request
        ? [
            await this.addressRefusals.consume(address),
            await this.refusals.consume(
              `${address}|${params.type}|${body.target}`,
            ),
          ]
        : [];
      const refused = attempts.find((attempt) => !attempt.allowed);
      if (refused) {
        // The attempt that did count goes back: this submission was not
        // looked at, so it is not a refused code.
        await this.refund(attempts);
        // A counter that could not be reached or was contended is an
        // outage, not a caller over its limit.
        if (refused.reason !== "limit") {
          throw new HttpError(
            { status: 503 },
            { message: "Verification is temporarily unavailable" },
          );
        }
        throw new VerificationThrottledError();
      }

      try {
        const result = await this.verificationService.verifyCode(
          {
            type: params.type,
            target: body.target,
          },
          body.token,
        );
        await this.refund(attempts);
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

  /**
   * Give back what a submission counted, on both limiters.
   */
  protected async refund(attempts: RateLimitResult[]): Promise<void> {
    const [address, target] = attempts;
    if (address?.ticket) await this.addressRefusals.refund(address.ticket);
    if (target?.ticket) await this.refusals.refund(target.ticket);
  }
}

import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { validateVerificationCodeResponseSchema } from "../schemas/validateVerificationCodeResponseSchema.ts";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";
import { VerificationService } from "../services/VerificationService.ts";

export class VerificationController {
  protected readonly verificationService = $inject(VerificationService);

  public readonly url = "/verifications";
  public readonly group = "verifications";

  // SECURITY: there is deliberately NO public "request a code" action here.
  // `VerificationService.createVerification` returns the raw token so that the
  // *caller* can deliver it out-of-band (email/SMS). Exposing that over HTTP —
  // as a previous `requestVerificationCode` action did, with no `$secure` — let
  // anyone request a code for any target and read it straight from the response,
  // defeating verification entirely. Verification requests are driven
  // server-side (RegistrationService / UserService call the service directly and
  // send the code); only code *submission* is public, below.
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
            "The verification token (6-digit code for phone, UUID for email).",
        }),
      }),
      response: validateVerificationCodeResponseSchema,
    },
    handler: async ({ body, params }) => {
      return this.verificationService.verifyCode(
        {
          type: params.type,
          target: body.target,
        },
        body.token,
      );
    },
  });
}

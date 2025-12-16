import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { requestVerificationCodeResponseSchema } from "../schemas/requestVerificationCodeResponseSchema.ts";
import { validateVerificationCodeResponseSchema } from "../schemas/validateVerificationCodeResponseSchema.ts";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";
import { VerificationService } from "../services/VerificationService.ts";

export class VerificationController {
  protected readonly verificationService = $inject(VerificationService);

  public readonly url = "/verifications";
  public readonly group = "verifications";

  public readonly requestVerificationCode = $action({
    path: `${this.url}/:type`,
    group: this.group,
    method: "POST",
    schema: {
      params: t.object({
        type: verificationTypeEnumSchema,
      }),
      body: t.object({
        target: t.text(),
      }),
      response: requestVerificationCodeResponseSchema,
    },
    handler: async ({ body, params }) => {
      return await this.verificationService.createVerification({
        type: params.type,
        target: body.target,
      });
    },
  });

  public readonly validateVerificationCode = $action({
    path: `${this.url}/:type/validate`,
    group: this.group,
    method: "POST",
    schema: {
      params: t.object({
        type: verificationTypeEnumSchema,
      }),
      body: t.object({
        target: t.text(),
        token: t.text({
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

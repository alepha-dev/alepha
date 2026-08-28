import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";

import { myMfaStatusSchema } from "../schemas/myMfaStatusSchema.ts";
import { MfaService } from "../services/MfaService.ts";

/**
 * Self-service two-factor authentication: enroll an authenticator app, prove
 * it works, print recovery codes, turn it off again.
 *
 * Scoped to the caller throughout, which is what lets these carry no
 * permission of their own. See {@link MyIdentityController} for the same
 * reasoning applied to sign-in methods, which is also where a TOTP
 * enrollment is stored.
 */
export class MyMfaController {
  protected readonly mfaService = $inject(MfaService);

  getMyMfa = $action({
    method: "GET",
    path: "/users/me/mfa",
    use: [$secure()],
    description: "Report which second factors the caller has set up",
    schema: {
      response: myMfaStatusSchema,
    },
    handler: async ({ user }) => {
      return this.mfaService.statusFor(user.id, user.realm);
    },
  });

  enrollTotp = $action({
    method: "POST",
    path: "/users/me/mfa/totp/enroll",
    use: [$secure()],
    description: "Start enrolling an authenticator app",
    schema: {
      response: z.object({
        secret: z
          .text()
          .describe(
            "The shared secret, for manual entry. Returned only here: it is stored encrypted and can never be shown again.",
          ),
        uri: z.text({ size: "rich" }),
        qrSvg: z
          .text({ size: "rich" })
          .describe("The enrollment URI as an inline SVG QR code"),
      }),
    },
    handler: async ({ user }) => {
      return this.mfaService.beginTotpEnrollment(user.id, user.realm);
    },
  });

  activateTotp = $action({
    method: "POST",
    path: "/users/me/mfa/totp/activate",
    use: [$secure()],
    description: "Confirm an enrollment and receive the recovery codes",
    schema: {
      body: z.object({
        code: z.text(),
      }),
      response: z.object({
        recoveryCodes: z
          .array(z.text())
          .describe(
            "Shown once. They are stored hashed, so nothing can display them again.",
          ),
      }),
    },
    handler: async ({ body, user }) => {
      return this.mfaService.activateTotp(user.id, body.code, user.realm);
    },
  });

  disableTotp = $action({
    method: "DELETE",
    path: "/users/me/mfa/totp",
    use: [$secure()],
    description: "Turn off two-factor authentication",
    schema: {
      body: z.object({
        code: z
          .text()
          .describe(
            "A current code, or a recovery code. Proves the caller still holds the second factor rather than merely holding a live session.",
          ),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ body, user }) => {
      // A live session is not enough on its own: someone with a borrowed
      // laptop could otherwise strip the account's second factor and lock
      // its owner out at leisure.
      await this.assertSecondFactor(user.id, body.code, user.realm);

      await this.mfaService.disableTotp(user.id, user.realm);
      return { ok: true };
    },
  });

  regenerateRecoveryCodes = $action({
    method: "POST",
    path: "/users/me/mfa/totp/recovery-codes",
    use: [$secure()],
    description: "Issue a new set of recovery codes, retiring the old one",
    schema: {
      response: z.object({
        recoveryCodes: z.array(z.text()),
      }),
    },
    handler: async ({ user }) => {
      return this.mfaService.regenerateRecoveryCodes(user.id, user.realm);
    },
  });

  protected async assertSecondFactor(
    userId: string,
    code: string,
    realm?: string,
  ): Promise<void> {
    const passed = await this.mfaService.verify(
      userId,
      this.mfaService.totpProvider,
      code,
      realm,
    );
    if (!passed) {
      throw new BadRequestError("That code is not valid");
    }
  }
}

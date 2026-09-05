import { z } from "alepha";
import { myMfaStatusSchema } from "alepha/api/users";
import { $action } from "alepha/server";

/**
 * Stands in for `MyMfaController`, for the account Security screen.
 *
 * `AccountSecurity` reads its two-factor state through `useQuery`, so without
 * this the page raised "Action getMyMfa not found" as a toast and drew NO
 * two-factor row at all. Neither the crawl nor the response-schema check could
 * see that: the page still returned 200 and logged no console error, because a
 * failed action is reported to the reader and not to the console.
 *
 * TOTP reports enabled with recovery codes left, which is the state with the
 * most to render - the disabled state is one button.
 *
 * The mutations answer rather than 404, because the screen's buttons are real
 * and a reader will press them. They change nothing: this site has no user to
 * enroll, and a dialog that opens onto a working QR would be claiming an
 * account exists.
 */
export class ShowcaseMfaController {
  public readonly getMyMfa = $action({
    path: "/users/me/mfa",
    schema: { response: myMfaStatusSchema },
    handler: () => ({
      totp: { enabled: true, pending: false, recoveryCodesLeft: 8 },
    }),
  });

  public readonly disableTotp = $action({
    method: "POST",
    path: "/users/me/mfa/totp/disable",
    schema: { response: z.object({ ok: z.boolean() }) },
    handler: () => ({ ok: true }),
  });
}

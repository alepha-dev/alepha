import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

/**
 * The realm this whole example exists to show.
 *
 * It is the "capacity" profile from the two-factor design: an internal tool
 * whose users are colleagues, with **no email provider at all**, so the second
 * factor has to be something the account carries on its own. That rules out
 * emailed codes and leaves TOTP, which needs no infrastructure beyond an
 * authenticator app the user already has.
 *
 * Everything below follows from that one constraint.
 */
export class TotpRealm {
  /**
   * Opens the `/admin` shell.
   *
   * The `admin` role carries `*`, so the account promoted below inherits this
   * without it being granted anywhere by name.
   */
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Opens the administration area",
  });

  realm = $realm({
    settings: {
      displayName: "Alepha TOTP demo",
      description: "Two-factor authentication with an authenticator app.",

      /*
       * The demo administrator, by username rather than by email.
       *
       * `adminUsernames` is the right list here because this realm has no
       * verified email to key on (see `email: "optional"` below). Register
       * `alepha` and that account is promoted; nothing else is.
       *
       * ⚠️ Promotion happens at **session creation**, not at registration, so
       * the role lands on the first sign-in rather than the moment the account
       * appears. An account that already exists is not rewritten retroactively.
       *
       * This is safe to commit precisely because a username is not a secret and
       * grants nothing on its own: whoever registers it first must still choose
       * a password, and this is a throwaway demo. Do not copy the pattern into
       * anything real without also closing registration.
       */
      adminUsernames: ["alepha"],

      /*
       * Open, because the point of the deployed demo is that you can make an
       * account and walk the enrollment yourself.
       */
      registrationAllowed: true,

      /*
       * Username is the identifier; email is optional and never verified.
       *
       * With no mail provider there is nothing to send a verification to, and a
       * realm that demanded a verified address would be a realm nobody could
       * finish registering on.
       */
      username: "required",
      email: "optional",
      firstNameLastName: "optional",
      phoneNumber: "none",

      /*
       * All three would need `features: { notifications: true }` and a provider
       * behind it. There is neither, and `$realm` refuses the combination that
       * claims otherwise, so they are off and say so.
       *
       * Password reset being off is worth sitting with: it is the honest
       * consequence of having no email channel. Lose the password here and the
       * account is gone. That is also exactly why the second factor is TOTP:
       * a realm whose reset channel is email gains much less from a second
       * factor that is also email.
       */
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: false,
      captchaRequired: false,

      /**
       * The setting this example is about.
       *
       * `optional` lets a user enroll from `/account/security` when they choose
       * to, and challenges them at sign-in once they have. `required` would be
       * the same plus a UI obligation to push an unenrolled user through
       * enrollment. Deliberately not used here, because the demo is more
       * useful when you can see both the enrolled and unenrolled states.
       *
       * `emailCode` is `disabled` rather than merely unconfigured: with the
       * gate now enforced server-side, that word is load-bearing. Enrollment is
       * refused, and the account page does not offer the row.
       */
      mfa: {
        totp: "optional",
        emailCode: "disabled",
      },

      defaultRoles: ["user"],

      /*
       * Deliberately mild. A demo you cannot get into teaches nothing, and the
       * password is not what this example is demonstrating.
       */
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecialCharacters: false,
      },
    },
  });
}

import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";
import { CurrentPasswordService } from "../services/CurrentPasswordService.ts";
import { PasskeyService } from "../services/PasskeyService.ts";
import { UserService } from "../services/UserService.ts";

/**
 * Self-service password change.
 *
 * Distinct from both neighbours on purpose. `UserService.setPassword` is the
 * ADMIN path, it verifies nothing, because an operator resetting an account
 * does not know the old password. The reset flow is the FORGOT path, and it
 * needs a mail provider to deliver a token. Neither covers the ordinary case:
 * a signed-in person who knows their password and wants a different one.
 *
 * Without this, an app whose realm has no email, an infrastructure panel, an
 * internal tool, has no way at all to change a password after the first one
 * is set.
 */
export class MyPasswordController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userService = $inject(UserService);
  protected readonly currentPassword = $inject(CurrentPasswordService);
  protected readonly passkeyService = $inject(PasskeyService);

  changeMyPassword = $action({
    method: "POST",
    path: "/users/me/password",
    use: [$secure({ sessionOnly: true })],
    description: "Change the caller's own password",
    schema: {
      body: z.object({
        currentPassword: z.text(),
        // No length bound here: the realm's own `passwordPolicy` is the single
        // source of truth, applied by `setPassword`. A second bound declared
        // at the edge would silently disagree with it the moment either moves.
        newPassword: z.text(),
      }),
      response: z.object({
        /**
         * How many other sessions were signed out. Reported so the UI can say
         * it rather than leave the person wondering whether their phone is
         * still logged in.
         */
        otherSessionsRevoked: z.integer(),
      }),
    },
    handler: async ({ body, user }) => {
      const identities = this.realmProvider.identityRepository(user.realm);
      const credentials = await identities.findOne({
        where: { userId: { eq: user.id }, provider: { eq: "credentials" } },
      });

      // No credentials identity means this account signs in some other way,
      // OAuth, an API key. There is no password to change, and inventing one
      // here would create a second way into an account whose owner never asked
      // for it.
      if (!credentials?.password) {
        throw new BadRequestError(
          "This account has no password set. It signs in through another provider.",
        );
      }

      // Counted against the account's login budget: without it a session
      // holder guesses the password here with no limit.
      const ok = await this.currentPassword.verify(
        user.id,
        body.currentPassword,
        user.realm,
      );
      if (!ok) {
        // This message and the "no password set" one above are DIFFERENT, and
        // that is safe here only because of `$secure()` + `user.id`: the caller
        // can only ever ask about their own account, so the pair discloses
        // nothing they do not already know. There is no id parameter to point
        // at somebody else.
        //
        // The distinction earns its keep, an OAuth-only account told "current
        // password is incorrect" would hunt for a password it never had.
        //
        // If this ever grows a way to name another account, the two must
        // collapse into one message first, or the endpoint becomes an oracle
        // for how any given account authenticates.
        throw new BadRequestError("Current password is incorrect");
      }

      if (body.newPassword === body.currentPassword) {
        throw new BadRequestError(
          "The new password must be different from the current one",
        );
      }

      await this.userService.setPassword(user.id, body.newPassword, user.realm);

      /*
        Every other session goes.

        The common reason to change a password is the belief that someone else
        has it. Leaving their session alive means the change accomplished
        nothing, they keep the access they already had, and the person who
        just changed it believes they are safe.

        The CURRENT session survives, so the act of securing an account does not
        also sign you out of the page you are standing on.
      */
      const otherSessionsRevoked = await this.userService.revokeSessions(
        user.id,
        user.realm,
        { except: user.sessionId },
      );

      return { otherSessionsRevoked };
    },
  });

  /**
   * Remove the caller's password, for an account that keeps another way to
   * sign in (a provider identity, a usable passkey).
   *
   * Asks for the current password, like changing it: with the password gone
   * the account proves itself with less, and "set a first password" opens
   * again, so a session alone must not be able to get there. The last way
   * to sign in never goes, and every other session is signed out.
   */
  removeMyPassword = $action({
    method: "DELETE",
    path: "/users/me/password",
    use: [$secure({ sessionOnly: true })],
    description: "Remove the caller's own password",
    schema: {
      body: z.object({
        currentPassword: z.text(),
      }),
      response: z.object({
        otherSessionsRevoked: z.integer(),
      }),
    },
    handler: async ({ body, user, url }) => {
      const identities = this.realmProvider.identityRepository(user.realm);
      const credentials = await identities.findOne({
        where: { userId: { eq: user.id }, provider: { eq: "credentials" } },
      });
      if (!credentials?.password) {
        throw new BadRequestError(
          "This account has no password set. It signs in through another provider.",
        );
      }

      const ok = await this.currentPassword.verify(
        user.id,
        body.currentPassword,
        user.realm,
      );
      if (!ok) {
        throw new BadRequestError("Current password is incorrect");
      }

      const ways = await this.passkeyService.waysToSignIn(
        user.id,
        user.realm,
        url.hostname,
      );
      if (ways.filter((it) => it.id !== credentials.id).length === 0) {
        throw new BadRequestError(
          "This is the only way to sign in to this account. Add another before removing it.",
        );
      }

      await identities.deleteById(credentials.id);

      const otherSessionsRevoked = await this.userService.revokeSessions(
        user.id,
        user.realm,
        { except: user.sessionId },
      );
      return { otherSessionsRevoked };
    },
  });
}

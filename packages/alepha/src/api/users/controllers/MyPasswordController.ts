import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $secure } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { UserService } from "../services/UserService.ts";

/**
 * Self-service password change.
 *
 * Distinct from both neighbours on purpose. `UserService.setPassword` is the
 * ADMIN path — it verifies nothing, because an operator resetting an account
 * does not know the old password. The reset flow is the FORGOT path, and it
 * needs a mail provider to deliver a token. Neither covers the ordinary case:
 * a signed-in person who knows their password and wants a different one.
 *
 * Without this, an app whose realm has no email — an infrastructure panel, an
 * internal tool — has no way at all to change a password after the first one
 * is set.
 */
export class MyPasswordController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userService = $inject(UserService);
  protected readonly crypto = $inject(CryptoProvider);

  changeMyPassword = $action({
    method: "POST",
    path: "/users/me/password",
    use: [$secure()],
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

      // No credentials identity means this account signs in some other way —
      // OAuth, an API key. There is no password to change, and inventing one
      // here would create a second way into an account whose owner never asked
      // for it.
      if (!credentials?.password) {
        throw new BadRequestError(
          "This account has no password set. It signs in through another provider.",
        );
      }

      const ok = await this.crypto.verifyPassword(
        body.currentPassword,
        credentials.password,
      );
      if (!ok) {
        // This message and the "no password set" one above are DIFFERENT, and
        // that is safe here only because of `$secure()` + `user.id`: the caller
        // can only ever ask about their own account, so the pair discloses
        // nothing they do not already know. There is no id parameter to point
        // at somebody else.
        //
        // The distinction earns its keep — an OAuth-only account told "current
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
        nothing — they keep the access they already had, and the person who
        just changed it believes they are safe.

        The CURRENT session survives, so the act of securing an account does not
        also sign you out of the page you are standing on.
      */
      const sessions = this.realmProvider.sessionRepository(user.realm);
      const rows = await sessions.findMany({
        where: { userId: { eq: user.id } },
      });
      const others = rows.filter((s) => s.id !== user.sessionId);
      for (const session of others) {
        await sessions.deleteById(session.id);
      }

      return { otherSessionsRevoked: others.length };
    },
  });
}

import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, BadRequestError, NotFoundError } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";
import { myIdentitySchema } from "../schemas/myIdentitySchema.ts";
import { MfaService } from "../services/MfaService.ts";
import { UserService } from "../services/UserService.ts";

/**
 * Self-service sign-in methods — the "how do I get in" half of an account's
 * security page: list what is linked, add a first password, unlink one.
 *
 * Scoped to the caller throughout; see {@link MyProfileController} for why
 * that is what lets these actions carry no permission.
 *
 * **Linking a new OAuth provider is not here.** It needs a redirect out to
 * the provider and back with a return path, which is an authorization flow
 * rather than a CRUD action — it belongs with the OAuth module's own routes.
 * Unlinking is the half that is a plain mutation, so it lives here.
 *
 * **A TOTP enrollment is not a sign-in method.** It is stored as an identity
 * row (see `MfaService.totpProvider`), but it is a second factor: it never
 * appears here, cannot be unlinked here, and does not count as a way in.
 * Removing it goes through `MyMfaController.disableTotp`, which asks for a
 * code, so a stolen session cannot strip 2FA through this route.
 */
export class MyIdentityController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userService = $inject(UserService);
  protected readonly mfaService = $inject(MfaService);

  protected identities(realm?: string) {
    return this.realmProvider.identityRepository(realm);
  }

  /**
   * The caller's identity rows that are a way to sign in: everything except
   * the TOTP enrollment.
   */
  protected async signInIdentities(user: { id: string; realm?: string }) {
    return this.identities(user.realm).findMany({
      where: {
        userId: { eq: user.id },
        provider: { ne: this.mfaService.totpProvider },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }

  listMyIdentities = $action({
    method: "GET",
    path: "/users/me/identities",
    use: [$secure()],
    description: "List the caller's sign-in methods",
    schema: {
      response: z.array(myIdentitySchema),
    },
    handler: async ({ user }) => {
      const rows = await this.signInIdentities(user);

      // Projected field by field rather than spread: a spread would publish
      // `password` and `providerData` the moment someone widened the
      // response schema, and the schema is the only thing that would have
      // stopped it.
      return rows.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      }));
    },
  });

  /**
   * Set a password on an account that has none — typically one created
   * through OAuth whose owner now wants a way in that does not depend on
   * the provider.
   */
  setMyFirstPassword = $action({
    method: "POST",
    path: "/users/me/identities/password",
    use: [$secure({ sessionOnly: true })],
    description: "Set a first password on an account that has none",
    schema: {
      body: z.object({
        // No length bound: the realm's `passwordPolicy` is the single source
        // of truth and `setPassword` applies it. Same reasoning as
        // `MyPasswordController`.
        password: z.text(),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ body, user }) => {
      const existing = await this.identities(user.realm).findOne({
        where: {
          userId: { eq: user.id },
          provider: { eq: "credentials" },
        },
      });

      /*
        This endpoint trusts the session and asks for no current password,
        which is defensible only while there is nothing to prove knowledge
        of. The moment a password exists, the same call would let anyone who
        walks up to an unlocked, signed-in browser replace it — a full
        account takeover with no credential needed.

        Changing a password therefore goes through `MyPasswordController`,
        which verifies the old one and revokes every other session.
      */
      if (existing?.password) {
        throw new BadRequestError(
          "This account already has a password. Use the change-password endpoint instead.",
        );
      }

      await this.userService.setPassword(user.id, body.password, user.realm);
      return { ok: true };
    },
  });

  unlinkMyIdentity = $action({
    method: "DELETE",
    path: "/users/me/identities/:id",
    use: [$secure({ sessionOnly: true })],
    description: "Unlink one of the caller's sign-in methods",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      const repo = this.identities(user.realm);

      // Sign-in methods only: the TOTP row reads as missing, like any id the
      // caller cannot unlink here. Owner-scoped the same way: someone else's
      // identity id reads as missing, so this endpoint cannot be used to
      // probe which ids exist.
      const all = await this.signInIdentities(user);
      const target = all.find((identity) => identity.id === params.id);
      if (!target) {
        throw new NotFoundError("Sign-in method not found");
      }

      /*
        The last one never goes.

        Removing it leaves an account with no way to authenticate — not
        locked, not disabled, simply unreachable forever, from a single
        click on a page that offers no undo. There is no recovery path
        either: password reset needs a credentials identity to reset.

        Only sign-in methods count: a TOTP enrollment left alone is no way
        in, so a password beside it is still the last one.
      */
      if (all.length <= 1) {
        throw new BadRequestError(
          "This is the only way to sign in to this account. Add another before removing it.",
        );
      }

      await repo.deleteById(target.id);
      return { ok: true };
    },
  });
}

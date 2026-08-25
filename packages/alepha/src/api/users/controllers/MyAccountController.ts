import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";
import { deleteMyAccountBodySchema } from "../schemas/deleteMyAccountBodySchema.ts";
import { UserService } from "../services/UserService.ts";

/**
 * Self-service account deletion.
 *
 * **This is a hard delete.** The account row, its identities and its sessions
 * go, through the same {@link UserService.deleteUser} the admin path uses —
 * one deletion semantic rather than two that drift. Soft-delete with a
 * bring-back window is a deliberate future decision, not an oversight; there
 * is no `deletedAt` on `users` to build it on today.
 *
 * ### Applications must opt in to what deletion means for their data
 *
 * The framework knows about users, identities and sessions. It does not know
 * that deleting an account orphans a project, or cascades through rows the
 * account holder authored inside *other people's* data — and it cannot,
 * because those foreign keys live in the application's own entities.
 *
 * So {@link UserService.deleteUser} emits {@link Hooks."user:delete:before"}
 * and awaits it before touching anything - on this path and on the admin one
 * alike - and an application subscribes with `$hook` to either clean up or
 * refuse:
 *
 * ```ts
 * class UserDeletionHook {
 *   protected readonly projects = $repository(projects);
 *
 *   onUserDelete = $hook({
 *     on: "user:delete:before",
 *     handler: async ({ userId }) => {
 *       const owned = await this.projects.count({ createdBy: { eq: userId } });
 *       if (owned > 0) {
 *         throw new ConflictError(`You still own ${owned} project(s).`);
 *       }
 *     },
 *   });
 * }
 * ```
 *
 * An application with foreign keys to `users.id` that has *not* written such
 * a hook is relying on its own cascade rules being correct. That is a real
 * choice, and it should be a considered one — the failure mode is silent
 * third-party data loss, visible nowhere in a diff.
 */
export class MyAccountController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userService = $inject(UserService);
  protected readonly crypto = $inject(CryptoProvider);

  deleteMyAccount = $action({
    method: "DELETE",
    path: "/users/me",
    use: [$secure()],
    description: "Permanently delete the caller's own account",
    schema: {
      body: deleteMyAccountBodySchema,
      response: okSchema,
    },
    handler: async ({ body, user }) => {
      const users = this.realmProvider.userRepository(user.realm);
      const account = await users.getOne({ where: { id: { eq: user.id } } });

      /*
        The confirmation phrase. Email, then username, then the literal
        `DELETE` — both columns are optional on the entity, and an account
        with neither would otherwise be confirmable with an empty string.
      */
      const expected = account.email ?? account.username ?? "DELETE";
      if (body.confirm !== expected) {
        throw new BadRequestError(`Type ${expected} to confirm deletion`);
      }

      const identities = this.realmProvider.identityRepository(user.realm);
      const credentials = await identities.findOne({
        where: {
          userId: { eq: user.id },
          provider: { eq: "credentials" },
        },
      });

      // A password account must prove knowledge of it. An OAuth-only account
      // has nothing to prove, so `confirm` alone stands — demanding a
      // password it never had would make deletion impossible.
      if (credentials?.password) {
        if (!body.currentPassword) {
          throw new BadRequestError("Your current password is required");
        }
        const ok = await this.crypto.verifyPassword(
          body.currentPassword,
          credentials.password,
        );
        if (!ok) {
          throw new BadRequestError("Current password is incorrect");
        }
      }

      // `deleteUser` emits `user:delete:before` and awaits it, so the
      // application's veto applies to this path and to an admin deletion
      // alike. Re-authentication above happens first on purpose: cleanup that
      // runs before the caller has proven who they are is a way to destroy
      // somebody else's data from an unattended browser.
      await this.userService.deleteUser(user.id, user.realm);

      return { ok: true };
    },
  });
}

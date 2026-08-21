import { $inject, Alepha } from "alepha";
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
 * So this emits {@link Hooks."user:delete:before"} first, and an application
 * subscribes with `$hook` to either clean up or refuse:
 *
 * ```ts
 * class UserDeletionHook {
 *   protected readonly projects = $repository(projects);
 *
 *   onUserDelete = $hook({
 *     on: "user:delete:before",
 *     handler: async ({ user }) => {
 *       const owned = await this.projects.count({ createdBy: { eq: user.id } });
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
  protected readonly alepha = $inject(Alepha);
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

      /*
        ⚠️ Emitted WITHOUT `{ log: true }`, and that is load-bearing.

        `EventManager.emit()`'s fast path rethrows a handler's error
        untouched, so an application's `ConflictError("You still own 3
        projects")` reaches the caller intact, with its own status and its own
        message. The logging path instead wraps it in
        `AlephaError("Failed during '…' hook for service: X", { cause })` —
        which would bury the only sentence the person needed to read behind a
        framework-internal one.

        Nothing is deleted before this resolves.
      */
      await this.alepha.events.emit("user:delete:before", {
        realm: user.realm,
        userId: user.id,
      });

      await this.userService.deleteUser(user.id, user.realm);

      return { ok: true };
    },
  });
}

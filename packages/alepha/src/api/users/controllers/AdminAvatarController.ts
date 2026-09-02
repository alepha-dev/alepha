import { $inject, Alepha, z } from "alepha";
import { $permission, $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { UserAudits } from "../audits/UserAudits.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { userResourceSchema } from "../schemas/userResourceSchema.ts";
import { UserStorage } from "../storage/UserStorage.ts";

/**
 * An operator manages somebody else's avatar.
 *
 * ⚠️ **A `variants` entry, not a `services` one**, exactly like
 * {@link MyAvatarController}: registered only by
 * `$realm({ features: { avatars: true } })`. A realm that switched avatars
 * off must not grow admin endpoints for them, and an unregistered action is
 * absent from `/api/_links`, so the admin UI's control hides itself with no
 * second gate to remember.
 *
 * Kept off {@link AdminUserController} for the reason the self-service pair
 * is kept off `MyProfileController`: that controller is always registered,
 * and putting these two actions on it would pull `UserStorage` in
 * transitively and leave the routes answering on every realm - which is
 * precisely the bug the split was made to fix.
 *
 * ## Its own permission
 *
 * `admin:user:avatar`, not `admin:user:update`. Reaching into somebody's
 * profile picture is a different capability from editing their roles or their
 * email, and an operator trusted with one is not automatically trusted with
 * the other. A new capability gets a new permission.
 */
export class AdminAvatarController {
  protected readonly alepha = $inject(Alepha);
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userFiles = $inject(UserStorage);

  readonly avatarPermission = $permission({
    name: "admin:user:avatar",
    description: "Manage another user's avatar",
  });

  protected users(realm?: string) {
    return this.realmProvider.userRepository(realm);
  }

  /**
   * The `user` audit type, when the realm keeps one.
   *
   * Same lookup as `CredentialService`: the type is registered by the audits
   * feature, so a realm without it has nothing to log to.
   */
  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    return realm.features.audits ? this.alepha.inject(UserAudits) : undefined;
  }

  updateUserAvatar = $action({
    method: "POST",
    path: "/admin/users/:id/avatar",
    group: "admin",
    use: [$secure({ permissions: ["admin:user:avatar"] })],
    description: "Replace another user's avatar",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ file: z.file() }),
      response: userResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const repo = this.users(user.realm);
      const target = await repo.findById(params.id);
      if (!target) {
        throw new NotFoundError(`User ${params.id} not found`);
      }

      const file = await this.userFiles.avatars.upload(body.file, { user });
      const updated = await repo.updateById(params.id, { picture: file.id });

      // Only after the row points at the new file, like the self-service
      // path: deleting first leaves a broken avatar if the upload then fails.
      await this.deletePrevious(target.picture, file.id);

      await this.userAudits(user.realm)?.user.logSuccess("update", {
        userId: user.id,
        userEmail: user.email,
        userRealm: user.realm,
        resourceType: "user",
        resourceId: params.id,
        description: "avatar replaced",
      });

      return updated as never;
    },
  });

  deleteUserAvatar = $action({
    method: "DELETE",
    path: "/admin/users/:id/avatar",
    group: "admin",
    use: [$secure({ permissions: ["admin:user:avatar"] })],
    description: "Remove another user's avatar",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: userResourceSchema,
    },
    handler: async ({ params, user }) => {
      const repo = this.users(user.realm);
      const target = await repo.findById(params.id);
      if (!target) {
        throw new NotFoundError(`User ${params.id} not found`);
      }

      const updated = await repo.updateById(params.id, { picture: undefined });
      await this.deletePrevious(target.picture);

      await this.userAudits(user.realm)?.user.logSuccess("update", {
        userId: user.id,
        userEmail: user.email,
        userRealm: user.realm,
        resourceType: "user",
        resourceId: params.id,
        description: "avatar removed",
      });

      return updated as never;
    },
  });

  /**
   * Drop the blob an avatar used to point at, once nothing references it.
   *
   * Failure is swallowed, for the reason `MyAvatarController` gives: the row
   * has already been updated, so turning a storage hiccup into a failed
   * request would report a lie. The cost is an orphaned blob, not a broken
   * account.
   */
  protected async deletePrevious(previous?: string, next?: string) {
    if (!previous || previous === next) {
      return;
    }
    try {
      await this.userFiles.avatars.delete(previous);
    } catch {
      // Orphaned blob; the account is correct.
    }
  }
}

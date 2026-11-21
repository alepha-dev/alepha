import { $inject, Alepha, z } from "alepha";
import { $secure } from "alepha/security";
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

  protected users(realm?: string) {
    return this.realmProvider.userRepository(realm);
  }

  /**
   * The `user` audit type, when the realm keeps one.
   *
   * Same lookup as `CredentialService`: every `$realm` registers the type,
   * and a realm registered straight through `RealmProvider` may not have it.
   */
  protected userAudits(realmName?: string) {
    return this.alepha.has(UserAudits)
      ? this.alepha.inject(UserAudits)
      : undefined;
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
      const target = await this.findInRealm(params.id, user.realm);

      const file = await this.userFiles.avatars.upload(body.file, { user });
      const updated = await repo.updateById(params.id, { picture: file.id });

      // Only after the row points at the new file, like the self-service
      // path: deleting first leaves a broken avatar if the upload then fails.
      await this.deletePrevious(user.realm, target.picture, file.id);

      await this.userAudits(user.realm)?.user.logSuccess("update", {
        userId: user.id,
        userEmail: user.email,
        userRealm: user.realm,
        resourceType: "user",
        resourceId: params.id,
        description: "avatar replaced",
      });

      return updated;
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
      const target = await this.findInRealm(params.id, user.realm);

      // `null`, not `undefined`, for the reason `MyAvatarController` gives:
      // `undefined` leaves the column alone and the row outlives its blob.
      const updated = await repo.updateById(params.id, { picture: null });
      await this.deletePrevious(user.realm, target.picture);

      await this.userAudits(user.realm)?.user.logSuccess("update", {
        userId: user.id,
        userEmail: user.email,
        userRealm: user.realm,
        resourceType: "user",
        resourceId: params.id,
        description: "avatar removed",
      });

      return updated;
    },
  });

  /**
   * The target, in the operator's own realm. The table is shared between
   * realms, so a user of another realm reads as missing, as it does on
   * `AdminUserController`.
   */
  protected async findInRealm(id: string, realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    const target = await this.users(realmName).findOne({
      where: { id: { eq: id }, realm: { eq: realm.name } },
    });
    if (!target) {
      throw new NotFoundError(`User ${id} not found`);
    }
    return target;
  }

  /**
   * Drop the file an avatar used to point at, unless another account's
   * avatar still points at it.
   *
   * Failure is swallowed, for the reason `MyAvatarController` gives: the row
   * has already been updated, so turning a storage hiccup into a failed
   * request would report a lie. The cost is an orphaned blob, not a broken
   * account.
   */
  protected async deletePrevious(
    realm: string | undefined,
    previous?: string,
    next?: string,
  ) {
    if (!previous || previous === next) {
      return;
    }
    try {
      if (
        await this.users(realm).findOne({
          where: { picture: { eq: previous } },
        })
      ) {
        return;
      }
      await this.userFiles.avatars.delete(previous);
    } catch {
      // Orphaned blob; the account is correct.
    }
  }
}

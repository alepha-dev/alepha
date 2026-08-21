import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";
import { myProfileSchema } from "../schemas/myProfileSchema.ts";
import { UserProfileMapper } from "../services/UserProfileMapper.ts";
import { UserStorage } from "../storage/UserStorage.ts";

/**
 * The caller's own avatar — upload and remove.
 *
 * ⚠️ **This is a `variants` entry, not a `services` one.** It is registered
 * only by `$realm({ features: { avatars: true } })`, alongside the
 * {@link UserStorage} it needs. That is the whole reason it is a separate
 * class from {@link MyProfileController}: these two actions used to live
 * there, which is always registered and injected `UserStorage` directly — so
 * the storage got pulled in transitively and both endpoints stayed live on
 * every realm, including the ones that had deliberately left `avatars` off
 * (the default). The flag gated a service nobody could observe and nothing
 * else, and `@alepha/ui`'s account page rendered an avatar picker regardless.
 *
 * Splitting it also makes the UI gate free rather than a second thing to
 * remember: an unregistered action is absent from `/api/_links`, so
 * `updateMyAvatar.can()` is false and the section hides itself. Same mechanism
 * the account router already uses for the API-keys page — a `$permission`
 * could not do this, because it is registered whether or not any controller
 * backs it.
 */
export class MyAvatarController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userFiles = $inject(UserStorage);
  protected readonly mapper = $inject(UserProfileMapper);

  protected users(realm?: string) {
    return this.realmProvider.userRepository(realm);
  }

  updateMyAvatar = $action({
    method: "POST",
    path: "/users/me/avatar",
    use: [$secure()],
    description: "Replace the caller's avatar",
    schema: {
      body: z.object({
        file: z.file(),
      }),
      response: myProfileSchema,
    },
    handler: async ({ body, user }) => {
      const repo = this.users(user.realm);
      const current = await repo.getOne({ where: { id: { eq: user.id } } });

      const file = await this.userFiles.avatars.upload(body.file, { user });
      const updated = await repo.updateById(user.id, { picture: file.id });

      // Only after the row points at the new file. Deleting first would leave
      // the account with a broken avatar if the upload then failed.
      await this.deletePrevious(current.picture, file.id);

      return this.mapper.toMyProfile(updated);
    },
  });

  deleteMyAvatar = $action({
    method: "DELETE",
    path: "/users/me/avatar",
    use: [$secure()],
    description: "Remove the caller's avatar",
    schema: {
      response: myProfileSchema,
    },
    handler: async ({ user }) => {
      const repo = this.users(user.realm);
      const current = await repo.getOne({ where: { id: { eq: user.id } } });

      const updated = await repo.updateById(user.id, { picture: undefined });
      await this.deletePrevious(current.picture);

      return this.mapper.toMyProfile(updated);
    },
  });

  /**
   * Drop the blob an avatar used to point at, once nothing references it.
   *
   * Failure is swallowed: the account has already been updated and the
   * person's avatar has already changed, so turning a storage hiccup into a
   * failed request would report a lie. The cost of losing this race is an
   * orphaned blob, not a broken account.
   */
  protected async deletePrevious(previous?: string, next?: string) {
    if (!previous || previous === next) {
      return;
    }
    try {
      await this.userFiles.avatars.delete(previous);
    } catch {
      // Orphaned blob; the profile is correct.
    }
  }
}

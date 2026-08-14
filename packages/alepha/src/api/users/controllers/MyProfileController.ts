import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, ConflictError } from "alepha/server";
import type { UserEntity } from "../entities/users.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { type MyProfile, myProfileSchema } from "../schemas/myProfileSchema.ts";
import { updateMyProfileBodySchema } from "../schemas/updateMyProfileBodySchema.ts";
import { UserStorage } from "../storage/UserStorage.ts";

/**
 * Self-service profile — the "who am I" page of an account area.
 *
 * Counterpart of {@link AdminUserController}, scoped to the CALLER. There is
 * no id parameter anywhere in this class, and that is what makes the whole
 * surface safe to leave un-permissioned: `$secure()` proves a session, and
 * `user.id` decides the row. An operator reading someone else's profile goes
 * through the admin controller, which has its own permissions.
 *
 * Un-permissioned is also the only workable choice. Gating "read your own
 * name" behind a permission means every realm has to remember to grant it,
 * and the failure mode is an account area that renders empty for users
 * nobody thought to configure. {@link MySessionController} and
 * {@link MyPasswordController} already made this call; this follows them.
 */
export class MyProfileController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly userFiles = $inject(UserStorage);

  protected users(realm?: string) {
    return this.realmProvider.userRepository(realm);
  }

  protected toMyProfile(user: UserEntity): MyProfile {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      phoneNumber: user.phoneNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      picture: user.picture,
      roles: user.roles,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  getMyProfile = $action({
    method: "GET",
    path: "/users/me",
    use: [$secure()],
    description: "Read the caller's own profile",
    schema: {
      response: myProfileSchema,
    },
    handler: async ({ user }) => {
      const row = await this.users(user.realm).getOne({
        where: { id: { eq: user.id } },
      });
      return this.toMyProfile(row);
    },
  });

  updateMyProfile = $action({
    method: "PATCH",
    path: "/users/me",
    use: [$secure()],
    description: "Update the caller's own profile",
    schema: {
      body: updateMyProfileBodySchema,
      response: myProfileSchema,
    },
    handler: async ({ body, user }) => {
      const repo = this.users(user.realm);

      /*
        Usernames are unique per realm, case-insensitively, through the
        `users_realm_username_lower_idx` index. Letting the write hit that
        index and translating the driver error would work, but the error text
        differs per backend (sqlite/postgres phrase it differently), so the
        translation is the fragile part rather than the check. Reading first
        is racy in principle — two people can claim the same name in the same
        millisecond — and that is fine here: the index is still the authority
        and the loser gets a 500 instead of a 409, on a collision that needs
        two strangers picking one name at the same instant.
      */
      if (body.username !== undefined) {
        const taken = await repo.findOne({
          where: {
            realm: { eq: user.realm ?? "default" },
            username: { eq: body.username },
          },
        });
        if (taken && taken.id !== user.id) {
          throw new ConflictError("That username is already taken");
        }
      }

      const updated = await repo.updateById(user.id, {
        firstName: body.firstName,
        lastName: body.lastName,
        username: body.username,
      });
      return this.toMyProfile(updated);
    },
  });

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

      return this.toMyProfile(updated);
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

      return this.toMyProfile(updated);
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

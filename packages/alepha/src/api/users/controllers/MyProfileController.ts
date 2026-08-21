import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $action, ConflictError } from "alepha/server";

import type { UserEntity } from "../entities/users.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { myProfileSchema } from "../schemas/myProfileSchema.ts";
import { updateMyProfileBodySchema } from "../schemas/updateMyProfileBodySchema.ts";
import { UserProfileMapper } from "../services/UserProfileMapper.ts";

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
 *
 * The avatar lives in {@link MyAvatarController} instead, because it is the
 * one part of a profile a realm can switch off (`features.avatars`) and this
 * class is always registered. See that class for what went wrong while the
 * two were together.
 */
export class MyProfileController {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly mapper = $inject(UserProfileMapper);

  protected users(realm?: string) {
    return this.realmProvider.userRepository(realm);
  }

  protected toMyProfile(user: UserEntity) {
    return this.mapper.toMyProfile(user);
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
}

import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ConflictError,
  okSchema,
} from "alepha/server";

import type { UserEntity } from "../entities/users.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { myProfileSchema } from "../schemas/myProfileSchema.ts";
import { updateMyProfileBodySchema } from "../schemas/updateMyProfileBodySchema.ts";
import { UsernameSlugger } from "../services/UsernameSlugger.ts";
import { UserProfileMapper } from "../services/UserProfileMapper.ts";
import { UserService } from "../services/UserService.ts";

/**
 * Self-service profile, the "who am I" page of an account area.
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
  protected readonly usernameSlugger = $inject(UsernameSlugger);
  protected readonly userService = $inject(UserService);

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

  /**
   * Send a verification code to the caller's own address (#Q4096), for the
   * account page's "Verify" while `emailVerified` is false. The address is
   * the one on file, never a parameter: nothing here reaches anybody
   * else's mailbox. An address already verified gets nothing, and answers
   * the same.
   */
  requestMyEmailVerification = $action({
    method: "POST",
    path: "/users/me/email-verification",
    use: [$secure({ sessionOnly: true })],
    description: "Send a verification code to the caller's own email address",
    schema: {
      response: okSchema,
    },
    handler: async ({ user }) => {
      const row = await this.users(user.realm).getOne({
        where: { id: { eq: user.id } },
      });
      if (!row.email) {
        throw new BadRequestError("This account has no email address");
      }
      await this.userService.requestEmailVerification(
        row.email,
        user.realm,
        "code",
      );
      return { ok: true };
    },
  });

  /**
   * Confirm the caller's own address with the code
   * {@link requestMyEmailVerification} sent (#Q4096). Answers the profile,
   * `emailVerified` now true.
   */
  verifyMyEmail = $action({
    method: "POST",
    path: "/users/me/email-verification/verify",
    use: [$secure({ sessionOnly: true })],
    description: "Verify the caller's own email address with the code sent",
    schema: {
      body: z.object({ code: z.string().min(1).max(64) }),
      response: myProfileSchema,
    },
    handler: async ({ body, user }) => {
      const repo = this.users(user.realm);
      const row = await repo.getOne({ where: { id: { eq: user.id } } });
      if (!row.email) {
        throw new BadRequestError("This account has no email address");
      }
      if (!row.emailVerified) {
        await this.userService.verifyEmail(row.email, body.code, user.realm);
      }
      return this.toMyProfile(
        await repo.getOne({ where: { id: { eq: user.id } } }),
      );
    },
  });

  updateMyProfile = $action({
    method: "PATCH",
    path: "/users/me",
    use: [$secure({ sessionOnly: true })],
    description: "Update the caller's own profile",
    schema: {
      body: updateMyProfileBodySchema,
      response: myProfileSchema,
    },
    handler: async ({ body, user }) => {
      const repo = this.users(user.realm);

      /*
        Usernames are unique per realm, case-insensitively, through the
        `users_realm_username_ci_idx` index. Letting the write hit that
        index and translating the driver error would work, but the error text
        differs per backend (sqlite/postgres phrase it differently), so the
        translation is the fragile part rather than the check. Reading first
        is racy in principle, two people can claim the same name in the same
        millisecond, and that is fine here: the index is still the authority
        and the loser gets a 500 instead of a 409, on a collision that needs
        two strangers picking one name at the same instant.
      */
      if (body.username !== undefined) {
        // The same rules registration applies: the format and the blocklist
        // are realm settings, not this endpoint's.
        const realm = this.realmProvider.getRealm(user.realm);
        const settings = await realm.getSettings();
        // A realm with no usernames has none to change: the column still
        // exists, and `adminUsernames` still reads it.
        if (settings.username === "none") {
          throw new BadRequestError("Usernames are not used on this realm");
        }
        if (
          settings.usernameRegExp &&
          !new RegExp(settings.usernameRegExp).test(body.username)
        ) {
          throw new BadRequestError(
            "Username does not meet the required format",
          );
        }
        // A blocklisted name, or one in `adminUsernames` (it grants the
        // admin role at the next refresh), is not there for the taking,
        // free or not. Whoever already holds it keeps it: a profile form
        // sends the username back unchanged.
        const current = await repo.getOne({ where: { id: { eq: user.id } } });
        if (
          current.username?.toLowerCase() !== body.username.toLowerCase() &&
          ((await this.usernameSlugger.isBlocked(user.realm, body.username)) ||
            (await this.usernameSlugger.isAdminName(user.realm, body.username)))
        ) {
          throw new BadRequestError("This username is not available");
        }

        const taken = await repo.findOne({
          where: {
            realm: { eq: realm.name },
            // Case-insensitive, like the unique index it mirrors.
            username: { eqInsensitive: body.username },
          },
        });
        if (taken && taken.id !== user.id) {
          throw new ConflictError("That username is already taken");
        }
      }

      const updated = await repo.updateById(user.id, {
        firstName: this.nameOrNull(body.firstName),
        lastName: this.nameOrNull(body.lastName),
        username: body.username,
      });
      return this.toMyProfile(updated);
    },
  });

  /**
   * A name sent empty (or blank) clears it, like `null`: an emptied text
   * box submits `""`, and storing that would leave an account with a first
   * name of nothing instead of none. `undefined` stays "leave it alone".
   * Done here so a form can send its values as they are.
   */
  protected nameOrNull(value: string | null | undefined) {
    if (value === undefined || value === null) {
      return value;
    }
    return value.trim() === "" ? null : value;
  }
}

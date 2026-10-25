import type { UserEntity } from "../entities/users.ts";
import type { MyProfile } from "../schemas/myProfileSchema.ts";

/**
 * Narrows a user row to the self-service view of it.
 *
 * A class of its own because two controllers answer with a `MyProfile` and
 * they are deliberately not the same class: `MyProfileController` is always
 * registered, `MyAvatarController` only when the realm enables avatars. A
 * second copy of this mapping in the other controller is exactly how a field
 * ends up visible on one endpoint and missing on the other.
 *
 * What it leaves out is the point: the row also carries `password`-adjacent
 * identity state, realm bookkeeping and audit columns, none of which belong in
 * a response the account holder's browser receives.
 */
export class UserProfileMapper {
  toMyProfile(user: UserEntity): MyProfile {
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
}

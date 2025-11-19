import { $repository, Repository } from "alepha/orm";
import { AlephaError } from "alepha";
import { identities } from "../entities/identities";
import { sessions } from "../entities/sessions";
import { users } from "../entities/users";
import { UserRealmOptions } from "alepha/api/users";

export interface UserRealmRepositories {
  identities: Repository<typeof identities.schema>;
  sessions: Repository<typeof sessions.schema>;
  users: Repository<typeof users.schema>;
}

export class UserRealmProvider {
  // Default repositories using $repository() for eager initialization
  protected readonly defaultIdentities = $repository(identities);
  protected readonly defaultSessions = $repository(sessions);
  protected readonly defaultUsers = $repository(users);

  protected realms = new Map<string, UserRealmRepositories>();

  public register(
    userRealmName: string,
    userRealmOptions: UserRealmOptions = {},
  ) {
    this.realms.set(userRealmName, {
      identities: userRealmOptions.entities?.identities ?? this.defaultIdentities,
      sessions: userRealmOptions.entities?.sessions ?? this.defaultSessions,
      users: userRealmOptions.entities?.users ?? this.defaultUsers,
    });
  }

  /**
   * Gets a registered realm by name, auto-creating default if needed.
   */
  protected getRealm(userRealmName: string): UserRealmRepositories {
    let realm = this.realms.get(userRealmName);

    if (!realm) {
      // Auto-register default realm for backward compatibility
      if (userRealmName === "default") {
        this.register("default");
        realm = this.realms.get("default")!;
      } else {
        throw new AlephaError(`Missing user realm '${userRealmName}', please declare $userRealm in your application.`);
      }
    }

    return realm;
  }

  public identityRepository(userRealmName = "default"): Repository<typeof identities.schema> {
    return this.getRealm(userRealmName).identities;
  }

  public sessionRepository(userRealmName = "default"): Repository<typeof sessions.schema> {
    return this.getRealm(userRealmName).sessions;
  }

  public userRepository(userRealmName = "default"): Repository<typeof users.schema> {
    return this.getRealm(userRealmName).users;
  }
}

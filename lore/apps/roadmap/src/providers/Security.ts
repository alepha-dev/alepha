import { $auth, $authGithub, $authGoogle } from "@alepha/react/auth";
import { $inject } from "alepha";
import { $userRealm, SessionService } from "alepha/api/users";
import type { UserAccountToken } from "alepha/security";
import type { Character } from "../entities/characters.ts";
import type { Project } from "../entities/projects.ts";
import { Db } from "./Db.ts";

export class Security {
  db = $inject(Db);
  realm = $userRealm();
  session = $inject(SessionService);

  // login providers
  credentials = $auth({
    realm: this.realm,
    credentials: {
      account: (creds) =>
        this.session.login("credentials", creds.username, creds.password),
    },
  });

  google = $authGoogle(this.realm, {
    account: (user) => this.session.link("google", user),
  });

  github = $authGithub(this.realm, {
    account: (user) => this.session.link("github", user),
  });

  async checkOwnership(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.db.projects.findOne({
      where: {
        id: { eq: projectId },
      },
    });

    if (project.createdBy !== user.id && !project.public && user.ownership) {
      return {
        project,
        character: await this.db.characters.findOne({
          where: {
            projectId: { eq: projectId },
            userId: { eq: user.id },
          },
        }),
      };
    }

    return { project };
  }
}

export interface ProjectGuard {
  project: Project;
  character?: Character;
}

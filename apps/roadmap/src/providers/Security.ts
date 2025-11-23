import { $inject } from "alepha";
import { $userRealm } from "alepha/api/users";
import type { UserAccountToken } from "alepha/security";
import { $authCredentials, $authGithub, $authGoogle } from "alepha/server/auth";
import type { Character } from "../entities/characters.ts";
import type { Project } from "../entities/projects.ts";
import { Db } from "./Db.ts";

export class Security {
  db = $inject(Db);
  realm = $userRealm({
    settings: {
      usernameRequired: true,
    },
  });

  credentials = $authCredentials(this.realm);
  google = $authGoogle(this.realm);
  github = $authGithub(this.realm);

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

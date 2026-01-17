import { $realm } from "alepha/api/users";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { type Character, characters } from "../entities/characters.ts";
import { type Project, projects } from "../entities/projects.ts";

export class AppSecurityProvider {
  projects = $repository(projects);
  characters = $repository(characters);

  realm = $realm({
    settings: {
      usernameRequired: true,
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      usernameRegExp: "^[a-zA-Z0-9_@.]{3,30}$",
    },
    identities: {
      github: true,
      google: true,
      credentials: true,
    },
  });

  async checkOwnership(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.projects.findOne({
      where: {
        id: { eq: projectId },
      },
    });

    if (project.createdBy !== user.id && !project.public && user.ownership) {
      return {
        project,
        character: await this.characters.findOne({
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

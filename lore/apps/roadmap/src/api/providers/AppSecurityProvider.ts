import { $realm } from "alepha/api/users";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { $swagger } from "alepha/server/swagger";
import { type Character, characters } from "../entities/characters.ts";
import { type Project, projects } from "../entities/projects.ts";

export class AppSecurityProvider {
  projects = $repository(projects);
  characters = $repository(characters);

  docs = $swagger({
    info: {
      title: "Roadmap API",
      description: "API documentation for the Roadmap application.",
      version: "1.0.0",
    },
  });

  realm = $realm({
    features: {
      apiKeys: true,
      files: true,
      audits: true,
      jobs: true,
      notifications: true,
    },
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
    const project = await this.projects.getOne({
      where: {
        id: { eq: projectId },
      },
    });

    if (project.createdBy !== user.id && !project.public && user.ownership) {
      return {
        project,
        character: await this.characters.getOne({
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

import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { type Character, characters } from "../entities/characters.ts";
import { type Project, projects } from "../entities/projects.ts";

export class AppSecurityProvider {
  projects = $repository(projects);
  characters = $repository(characters);

  env = $env(
    t.object({
      ADMIN_EMAIL: t.optional(t.email()),
    }),
  );

  realm = $realm({
    features: {
      apiKeys: true,
      avatars: true,
      audits: true,
      jobs: true,
      notifications: true,
    },
    settings: {
      username: "required",
      usernameRegExp: "^[a-zA-Z0-9_@.]{3,30}$",
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],
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

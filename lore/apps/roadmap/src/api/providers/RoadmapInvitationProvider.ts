import { $inject } from "alepha";
import {
  type InvitationEntity,
  InvitationProvider,
} from "alepha/api/invitations";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { AppSecurityProvider } from "./AppSecurityProvider.ts";

export class RoadmapInvitationProvider extends InvitationProvider {
  protected readonly projects = $repository(projects);
  protected readonly characters = $repository(characters);
  protected readonly security = $inject(AppSecurityProvider);

  async validateResource(
    resourceType: string,
    resourceId: string,
    inviter: { id: string; email?: string },
  ): Promise<void> {
    if (resourceType !== "project") {
      throw new BadRequestError("Unknown resource type");
    }
    await this.security.checkOwnership(Number(resourceId), inviter as any);
  }

  async isMember(
    _resourceType: string,
    resourceId: string,
    _email: string,
    userId?: string,
  ): Promise<boolean> {
    if (!userId) return false;
    const character = await this.characters.findOne({
      where: {
        projectId: { eq: Number(resourceId) },
        userId: { eq: userId },
      },
    });
    return !!character;
  }

  async onAccept(
    invitation: InvitationEntity,
    acceptedBy: { id: string },
  ): Promise<void> {
    await this.characters.create({
      projectId: Number(invitation.resourceId),
      userId: acceptedBy.id,
      xp: 0,
      balance: 0,
      owner: false,
    });
  }

  async getResourceInfo(
    _resourceType: string,
    resourceId: string,
  ): Promise<{ name: string }> {
    const project = await this.projects.getOne({
      where: { id: { eq: Number(resourceId) } },
    });
    return { name: project.title };
  }
}

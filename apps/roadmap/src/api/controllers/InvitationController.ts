import { $inject, t } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { characters } from "../entities/characters.ts";
import { invitations } from "../entities/invitations.ts";
import { projects } from "../entities/projects.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class InvitationController {
  log = $logger();
  invitations = $repository(invitations);
  users = $repository(users);
  characters = $repository(characters);
  projects = $repository(projects);
  security = $inject(AppSecurityProvider);

  createInvitation = $action({
    use: [$secure()],
    schema: {
      body: t.object({
        projectId: t.integer(),
        invitedEmail: t.string({ format: "email" }),
      }),
      response: invitations.schema,
    },
    handler: async ({ body, user }) => {
      // Check if user has permission to invite to this project
      await this.security.checkOwnership(body.projectId, user);

      // Check if user is trying to invite themselves
      if (body.invitedEmail === user.email) {
        throw new BadRequestError("You cannot invite yourself to a project");
      }

      // Check if user is already a member of the project
      const invitedUser = await this.users.findOne({
        where: {
          email: { eq: body.invitedEmail },
        },
      });

      if (invitedUser) {
        const existingCharacter = await this.characters.findOne({
          where: {
            projectId: { eq: body.projectId },
            userId: { eq: invitedUser.id },
          },
        });

        if (existingCharacter) {
          throw new BadRequestError("User is already a member of this project");
        }
      }

      // Check if invitation already exists
      const existingInvitation = await this.invitations.findOne({
        where: {
          projectId: { eq: body.projectId },
          invitedEmail: { eq: body.invitedEmail },
          status: { eq: "pending" },
        },
      });

      if (existingInvitation) {
        throw new BadRequestError(
          "An invitation has already been sent to this email for this project",
        );
      }

      // Create the invitation
      return await this.invitations.create({
        projectId: body.projectId,
        invitedBy: user.id,
        invitedEmail: body.invitedEmail,
        status: "pending",
      });
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  getMyInvitations = $action({
    use: [$secure()],
    schema: {
      response: t.array(
        t.object({
          id: t.uuid(),
          projectId: t.integer(),
          projectTitle: t.string(),
          invitedBy: t.uuid(),
          inviterName: t.optional(t.string()),
          inviterEmail: t.optional(t.string()),
          status: t.enum(["pending", "accepted", "rejected"]),
          createdAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userInvitations = await this.invitations.findMany({
        where: { invitedEmail: { eq: user.email } },
      });

      return await Promise.all(
        userInvitations.map(async (invitation) => {
          const [project, inviter] = await Promise.all([
            this.projects.getOne({
              where: {
                id: { eq: invitation.projectId },
              },
            }),
            this.users.getOne({
              where: {
                id: { eq: invitation.invitedBy },
              },
            }),
          ]);

          return {
            id: invitation.id,
            projectId: invitation.projectId,
            projectTitle: project.title,
            invitedBy: invitation.invitedBy,
            inviterName: inviter.username,
            inviterEmail: inviter.email,
            status: invitation.status,
            createdAt: invitation.createdAt,
          };
        }),
      );
    },
  });

  acceptInvitation = $action({
    use: [$secure()],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const invitation = await this.invitations.getOne({
        where: {
          id: { eq: params.id },
          invitedEmail: { eq: user.email },
          status: { eq: "pending" },
        },
      });

      // Check if user is already a member of the project
      const existingCharacter = await this.characters.findOne({
        where: {
          projectId: { eq: invitation.projectId },
          userId: { eq: user.id },
        },
      });

      if (existingCharacter) {
        // Update invitation status and return
        await this.invitations.save({
          ...invitation,
          status: "accepted",
        });
        return {
          ok: true,
        };
      }

      // Create character for the user
      await this.characters.create({
        projectId: invitation.projectId,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: false,
      });

      // Update invitation status
      await this.invitations.save({
        ...invitation,
        status: "accepted",
      });

      return {
        ok: true,
      };
    },
  });

  rejectInvitation = $action({
    use: [$secure()],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const invitation = await this.invitations.getOne({
        where: {
          id: { eq: params.id },
          invitedEmail: { eq: user.email },
          status: { eq: "pending" },
        },
      });

      // Delete the invitation
      await this.invitations.deleteById(invitation.id);

      return {
        ok: true,
      };
    },
  });

  getProjectInvitations = $action({
    use: [$secure()],
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.array(invitations.schema),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      return await this.invitations.findMany({
        where: { projectId: { eq: params.projectId } },
      });
    },
  });
}

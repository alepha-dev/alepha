import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { invitations } from "../entities/invitations.ts";
import { Db } from "../providers/Db.ts";
import { Security } from "../providers/Security.ts";

export class InvitationApi {
  log = $logger();
  db = $inject(Db);
  security = $inject(Security);

  createInvitation = $action({
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
      const invitedUser = await this.db.users
        .findOne({
          where: {
            email: { eq: body.invitedEmail },
          },
        })
        .catch(() => null);

      if (invitedUser) {
        const existingCharacter = await this.db.characters
          .findOne({
            where: {
              projectId: { eq: body.projectId },
              userId: { eq: invitedUser.id },
            },
          })
          .catch(() => null);

        if (existingCharacter) {
          throw new BadRequestError("User is already a member of this project");
        }
      }

      // Check if invitation already exists
      const existingInvitation = await this.db.invitations
        .findOne({
          where: {
            projectId: { eq: body.projectId },
            invitedEmail: { eq: body.invitedEmail },
            status: { eq: "pending" },
          },
        })
        .catch(() => null);

      if (existingInvitation) {
        throw new BadRequestError(
          "An invitation has already been sent to this email for this project",
        );
      }

      // Create the invitation
      return await this.db.invitations.create({
        projectId: body.projectId,
        invitedBy: user.id,
        invitedEmail: body.invitedEmail,
        status: "pending",
      });
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  getMyInvitations = $action({
    schema: {
      response: t.array(
        t.object({
          id: t.uuid(),
          projectId: t.integer(),
          projectTitle: t.string(),
          invitedBy: t.uuid(),
          inviterName: t.optional(t.string()),
          inviterEmail: t.string(),
          status: t.enum(["pending", "accepted", "rejected"]),
          createdAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userInvitations = await this.db.invitations.findMany({
        where: { invitedEmail: { eq: user.email } },
      });

      return await Promise.all(
        userInvitations.map(async (invitation) => {
          const [project, inviter] = await Promise.all([
            this.db.projects.findOne({
              where: {
                id: { eq: invitation.projectId },
              },
            }),
            this.db.users.findOne({
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
            inviterName: inviter.name,
            inviterEmail: inviter.email,
            status: invitation.status,
            createdAt: invitation.createdAt,
          };
        }),
      );
    },
  });

  acceptInvitation = $action({
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const invitation = await this.db.invitations.findOne({
        where: {
          id: { eq: params.id },
          invitedEmail: { eq: user.email },
          status: { eq: "pending" },
        },
      });

      // Check if user is already a member of the project
      const existingCharacter = await this.db.characters
        .findOne({
          where: {
            projectId: { eq: invitation.projectId },
            userId: { eq: user.id },
          },
        })
        .catch(() => null);

      if (existingCharacter) {
        // Update invitation status and return
        await this.db.invitations.save({
          ...invitation,
          status: "accepted",
        });
        return {
          ok: true,
        };
      }

      // Create character for the user
      await this.db.characters.create({
        projectId: invitation.projectId,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: false,
      });

      // Update invitation status
      await this.db.invitations.save({
        ...invitation,
        status: "accepted",
      });

      return {
        ok: true,
      };
    },
  });

  rejectInvitation = $action({
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const invitation = await this.db.invitations.findOne({
        where: {
          id: { eq: params.id },
          invitedEmail: { eq: user.email },
          status: { eq: "pending" },
        },
      });

      // Delete the invitation
      await this.db.invitations.deleteById(invitation.id);

      return {
        ok: true,
      };
    },
  });

  getProjectInvitations = $action({
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.array(invitations.schema),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      return await this.db.invitations.findMany({
        where: { projectId: { eq: params.projectId } },
      });
    },
  });
}

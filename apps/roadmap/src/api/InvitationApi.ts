import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $action, BadRequestError, ForbiddenError } from "@alepha/server";
import { Db, invitations } from "./providers/Db.ts";

export class InvitationApi {
	log = $logger();
	db = $inject(Db);

	createInvitation = $action({
		schema: {
			body: t.object({
				projectId: t.int(),
				invitedEmail: t.string({ format: "email" }),
			}),
			response: invitations.$schema,
		},
		handler: async ({ body, user }) => {
			// Check if user has permission to invite to this project
			const project = await this.db.projects.findOne({
				id: { eq: body.projectId },
			});

			if (project.createdBy !== user.id && user.ownership) {
				throw new ForbiddenError(
					`You do not have permission to invite to project with id ${body.projectId}`,
				);
			}

			// Check if user is trying to invite themselves
			if (body.invitedEmail === user.email) {
				throw new BadRequestError("You cannot invite yourself to a project");
			}

			// Check if user is already a member of the project
			const invitedUser = await this.db.users
				.findOne({
					email: { eq: body.invitedEmail },
				})
				.catch(() => null);

			if (invitedUser) {
				const existingCharacter = await this.db.characters
					.findOne({
						projectId: { eq: body.projectId },
						userId: { eq: invitedUser.id },
					})
					.catch(() => null);

				if (existingCharacter) {
					throw new BadRequestError("User is already a member of this project");
				}
			}

			// Check if invitation already exists
			const existingInvitation = await this.db.invitations
				.findOne({
					projectId: { eq: body.projectId },
					invitedEmail: { eq: body.invitedEmail },
					status: { eq: "pending" },
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

	getMyInvitations = $action({
		schema: {
			response: t.array(
				t.object({
					id: t.uuid(),
					projectId: t.int(),
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
			const userInvitations = await this.db.invitations.find({
				where: { invitedEmail: { eq: user.email } },
			});

			return await Promise.all(
				userInvitations.map(async (invitation) => {
					const [project, inviter] = await Promise.all([
						this.db.projects.findOne({
							id: { eq: invitation.projectId },
						}),
						this.db.users.findOne({
							id: { eq: invitation.invitedBy },
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
			response: t.boolean(),
		},
		handler: async ({ params, user }) => {
			const invitation = await this.db.invitations.findOne({
				id: { eq: params.id },
			});

			// Check if the invitation belongs to the current user
			if (invitation.invitedEmail !== user.email) {
				throw new ForbiddenError(
					"You do not have permission to accept this invitation",
				);
			}

			// Check if invitation is pending
			if (invitation.status !== "pending") {
				throw new BadRequestError(
					`Invitation has already been ${invitation.status}`,
				);
			}

			// Check if user is already a member of the project
			const existingCharacter = await this.db.characters
				.findOne({
					projectId: { eq: invitation.projectId },
					userId: { eq: user.id },
				})
				.catch(() => null);

			if (existingCharacter) {
				// Update invitation status and return
				await this.db.invitations.save({
					...invitation,
					status: "accepted",
				});
				return true;
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

			return true;
		},
	});

	rejectInvitation = $action({
		schema: {
			params: t.object({
				id: t.uuid(),
			}),
			response: t.boolean(),
		},
		handler: async ({ params, user }) => {
			const invitation = await this.db.invitations.findOne({
				id: { eq: params.id },
			});

			// Check if the invitation belongs to the current user
			if (invitation.invitedEmail !== user.email) {
				throw new ForbiddenError(
					"You do not have permission to reject this invitation",
				);
			}

			// Check if invitation is pending
			if (invitation.status !== "pending") {
				throw new BadRequestError(
					`Invitation has already been ${invitation.status}`,
				);
			}

			// Delete the invitation
			await this.db.invitations.deleteById(invitation.id);

			return true;
		},
	});

	getProjectInvitations = $action({
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
			response: t.array(invitations.$schema),
		},
		handler: async ({ params, user }) => {
			// Check if user has permission to view invitations for this project
			const project = await this.db.projects.findOne({
				id: { eq: params.projectId },
			});

			if (project.createdBy !== user.id && user.ownership) {
				throw new ForbiddenError(
					`You do not have permission to view invitations for project with id ${params.projectId}`,
				);
			}

			return await this.db.invitations.find({
				where: { projectId: { eq: params.projectId } },
			});
		},
	});
}

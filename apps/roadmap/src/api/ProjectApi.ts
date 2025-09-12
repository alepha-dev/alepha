import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { pageQuerySchema } from "@alepha/postgres";
import { $action, ForbiddenError } from "@alepha/server";
import {
	type Character,
	characters,
	Db,
	projects,
	tasks,
	type User,
	users,
} from "./providers/Db.ts";

export class ProjectApi {
	log = $logger();
	db = $inject(Db);

	createProject = $action({
		schema: {
			body: t.pick(projects.$insertSchema, ["title", "public"]),
			response: projects.$schema,
		},
		handler: async ({ body, user }) => {
			// TODO: load user + check if they have a free project slot

			const count = await this.db.projects.count({
				createdBy: user.id,
			});

			if (count >= 5) {
				throw new ForbiddenError(
					"You have reached the maximum number of projects allowed.",
				);
			}

			const project = await this.db.projects.create({
				...body,
				createdBy: user.id,
			});

			await this.db.characters.create({
				projectId: project.id,
				userId: user.id,
				xp: 0,
				balance: 0,
				owner: true,
			});

			return project;
		},
	});

	updateProjectById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			body: t.partial(t.pick(projects.$insertSchema, ["title", "public"])),
			response: projects.$schema,
		},
		handler: async ({ params, body, user }) => {
			const project = await this.db.projects.findOne(params);

			// for now, only the project creator or an admin can update a project
			if (user.ownership && project.createdBy !== user.id) {
				throw new ForbiddenError(
					`You do not have permission to update project with id ${params.id}`,
				);
			}

			if (body.title) {
				project.title = body.title.trim();
			}

			if (body.public != null) {
				project.public = body.public;
			}

			return await this.db.projects.save(project);
		},
	});

	getMyProjects = $action({
		description: "Get all projects for the authenticated user",
		schema: {
			query: pageQuerySchema,
			response: t.array(projects.$schema),
		},
		handler: async ({ user }) => {
			const characters = await this.db.characters.find({
				where: { userId: { eq: user.id } },
			});
			const characterProjectIds = characters.map((it) => it.projectId);
			return await this.db.projects.find({
				where: { id: { inArray: characterProjectIds } },
				limit: characterProjectIds.length,
			});
		},
	});

	getProjectById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.composite([
				projects.$schema,
				t.object({
					character: t.optional(characters.$schema),
					tasks: t.array(tasks.$schema),
				}),
			]),
		},
		handler: async ({ params, user }) => {
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			const character = await this.db.characters
				.findOne({
					projectId: { eq: params.id },
					userId: { eq: user.id },
				})
				.catch((err) => {
					if (project.public) return undefined;
					throw err;
				});

			const tasks = await this.db.tasks.find({
				where: {
					projectId: { eq: params.id },
					completedAt: { isNull: true },
					acceptedBy: { eq: user.id },
				},
			});

			return { ...project, tasks, character };
		},
	});

	getProjectPlayers = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.array(
				t.composite([
					characters.$schema,
					t.object({
						user: users.$schema,
					}),
				]),
			),
		},
		handler: async ({ params, user }) => {
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			// Check if user has access to this project
			if (project.createdBy !== user.id && !project.public && user.ownership) {
				await this.db.characters.findOne({
					projectId: { eq: params.id },
					userId: { eq: user.id },
				});
			}

			const projectCharacters = await this.db.characters.find({
				where: { projectId: { eq: params.id } },
			});

			const users = await this.db.users.find({
				limit: projectCharacters.length,
				where: {
					id: { inArray: projectCharacters.map((char) => char.userId) },
				},
			});

			const charactersWithUsers: Array<
				Character & {
					user: User;
				}
			> = [];

			for (const character of projectCharacters) {
				const characterUser = users.find((it) => it.id === character.userId);
				if (!characterUser) {
					this.log.warn(
						`User with id ${character.userId} not found for character ${character.id}`,
					);
					continue;
				}
				charactersWithUsers.push({
					...character,
					user: characterUser,
				});
			}

			// Sort by owner first, then by creation date
			return charactersWithUsers.sort((a, b) => {
				if (a.owner && !b.owner) return -1;
				if (!a.owner && b.owner) return 1;
				return (
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
				);
			});
		},
	});

	deleteProjectById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.boolean(),
		},
		handler: async ({ params, user }) => {
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			if (user.ownership && project.createdBy !== user.id) {
				throw new ForbiddenError(
					`You do not have permission to delete project with id ${params.id}`,
				);
			}

			await this.db.projects.deleteById(params.id);
			await this.db.characters.deleteMany({
				projectId: { eq: params.id },
			});
			await this.db.tasks.deleteMany({
				projectId: { eq: params.id },
			});

			return true;
		},
	});
}

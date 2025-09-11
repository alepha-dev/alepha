import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { pageQuerySchema } from "@alepha/postgres";
import { $action, ForbiddenError } from "@alepha/server";
import { characters, Db, projects, tasks } from "./providers/Db.ts";

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
			return this.db.projects.find({
				where: {
					createdBy: { eq: user.id },
				},
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

			if (project.createdBy !== user.id && user.ownership && !project.public) {
				throw new ForbiddenError(
					`You do not have permission to access project with id ${params.id}`,
				);
			}

			const tasks = await this.db.tasks.find({
				where: {
					projectId: { eq: params.id },
					completedAt: { isNull: true },
					acceptedBy: { eq: user.id },
				},
			});

			if (user.id === project.createdBy) {
				const character = await this.db.characters.findOne({
					projectId: { eq: params.id },
					userId: { eq: user.id },
				});
				return { ...project, tasks, character };
			}

			return { ...project, tasks, character: undefined };
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

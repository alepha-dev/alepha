import { $inject, $logger, t } from "@alepha/core";
import { PgEntityNotFoundError, pageQuerySchema } from "@alepha/postgres";
import { $action, ForbiddenError, NotFoundError } from "@alepha/server";
import { characters, Db, projects, tasks } from "./providers/Db.ts";

class ProjectApi {
	log = $logger();
	db = $inject(Db);

	createProject = $action({
		schema: {
			body: t.pick(projects.$insertSchema, ["title", "public"]),
			response: projects.$schema,
		},
		handler: async ({ body, user }) => {
			const project = await this.db.projects.create({
				...body,
				createdBy: user.id,
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
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			if (!project) {
				throw new NotFoundError(`Project with id ${params.id} not found`);
			}

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

	getProjects = $action({
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

			const tasks = await this.db.tasks.find({
				where: {
					projectId: { eq: params.id },
					completedAt: { isNull: true },
				},
			});

			if (project.createdBy !== user.id && user.ownership) {
				throw new ForbiddenError(
					`You do not have permission to access project with id ${params.id}`,
				);
			}

			if (user.id === project.createdBy) {
				const character = await this.db.characters
					.findOne({
						projectId: { eq: params.id },
						userId: { eq: user.id },
					})
					.catch((err) => {
						if (err instanceof PgEntityNotFoundError) {
							return this.db.characters.create({
								projectId: params.id,
								userId: user.id,
								xp: 0,
							});
						}
						throw err;
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

			return true;
		},
	});
}

export default ProjectApi;

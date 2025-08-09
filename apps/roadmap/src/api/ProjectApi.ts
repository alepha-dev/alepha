import { $inject, $logger, t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/postgres";
import { $action, ForbiddenError, NotFoundError } from "@alepha/server";
import { Db, projects } from "../providers/Db.ts";

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

	getProjects = $action({
		schema: {
			query: pageQuerySchema,
			response: t.array(projects.$schema),
		},
		handler: async ({ query, user }) => {
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
			response: projects.$schema,
		},
		handler: async ({ params }) => {
			return await this.db.projects.findOne({
				id: { eq: params.id },
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

			if (!project) {
				throw new NotFoundError(`Project with id ${params.id} not found`);
			}

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

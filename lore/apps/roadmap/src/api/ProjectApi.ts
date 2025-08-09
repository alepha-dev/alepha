import { $inject, $logger, t } from "@alepha/core";
import { $action } from "@alepha/server";
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
			response: projects.$schema,
		},
		handler: async ({ params }) => {
			return await this.db.projects.findOne({
				id: { eq: params.id },
			});
		},
	});
}

export default ProjectApi;

import { $inject, $logger, t } from "@alepha/core";
import { pageQuerySchema, pg } from "@alepha/postgres";
import { $action } from "@alepha/server";
import { Db, projects } from "../providers/Db.ts";

class ProjectApi {
	log = $logger();
	db = $inject(Db);

	getProjects = $action({
		group: "admin",
		schema: {
			query: pageQuerySchema,
			response: pg.page(projects.$schema),
		},
		handler: async ({ query }) => {
			return this.db.projects.paginate(query);
		},
	});

	getPublicProjects = $action({
		group: "read",
		schema: {
			query: pageQuerySchema,
			response: pg.page(projects.$schema),
		},
		handler: async ({ query }) => {
			return this.db.projects.paginate(query, {
				where: {
					public: { eq: true },
				},
			});
		},
	});

	getProjectById = $action({
		group: "read",
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

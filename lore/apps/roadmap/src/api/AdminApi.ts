import { $inject } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { pageQuerySchema, pageSchema } from "@alepha/postgres";
import { $action } from "@alepha/server";
import { Db, projects, users } from "../providers/Db.ts";

export class AdminApi {
  log = $logger();
  db = $inject(Db);

  getAllUsers = $action({
    group: "admin",
    schema: {
      query: pageQuerySchema,
      response: pageSchema(users.$schema),
    },
    handler: async ({ query }) => {
      return await this.db.users.paginate(query, {}, { count: true });
    },
  });

  getAllProjects = $action({
    group: "admin",
    schema: {
      query: pageQuerySchema,
      response: pageSchema(projects.$schema),
    },
    handler: async ({ query }) => {
      query.sort ??= "-createdAt";
      return await this.db.projects.paginate(
        query,
        {},
        { count: true, force: true }, // force: true to include soft-deleted items
      );
    },
  });
}

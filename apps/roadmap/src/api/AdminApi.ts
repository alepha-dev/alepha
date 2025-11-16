import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { pageQuerySchema, pageSchema } from "alepha/orm";
import { $action } from "alepha/server";
import { projects } from "../entities/projects.ts";
import { Db } from "../providers/Db.ts";

export class AdminApi {
  log = $logger();
  db = $inject(Db);

  getAllUsers = $action({
    group: "admin",
    schema: {
      query: pageQuerySchema,
      response: pageSchema(users.schema),
    },
    handler: async ({ query }) => {
      return await this.db.users.paginate(query, {}, { count: true });
    },
  });

  getAllProjects = $action({
    group: "admin",
    schema: {
      query: pageQuerySchema,
      response: pageSchema(projects.schema),
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

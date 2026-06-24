import { z } from "alepha";
import { $entity, $repository, db, sql } from "alepha/orm";
import { $action } from "alepha/server";

const viewEntity = $entity({
  name: "views",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    count: z.integer(),
  }),
  indexes: [
    {
      name: "name_idx",
      columns: ["name"],
      unique: true,
    },
  ],
});

export class CountApi {
  views = $repository(viewEntity);
  inc = $action({
    schema: {
      response: z.object({
        count: z.integer(),
      }),
    },
    handler: async () => {
      return await this.views.upsert(
        { name: "home", count: 1 },
        {
          target: ["name"],
          set: {
            count: sql`${this.views.table.count} + 1`,
          },
        },
      );
    },
  });
}

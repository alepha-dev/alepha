import { t } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { $action } from "alepha/server";
import { sql } from "drizzle-orm";

const viewEntity = $entity({
  name: "views",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
    count: t.integer(),
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
      response: t.object({
        count: t.integer(),
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

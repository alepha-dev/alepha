import { z } from "alepha";
import { $entity, $repository, db, sql } from "alepha/orm";
import { $action } from "alepha/server";

const visitEntity = $entity({
  name: "visits",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
    count: z.integer(),
  }),
  indexes: [{ name: "visits_name_idx", columns: ["name"], unique: true }],
});

/**
 * A counter, so the app has state worth backing up and worth surviving a
 * redeploy.
 *
 * Declaring `$repository` is the whole point: it is what puts
 * `resources.hasDatabase: true` into `dist/manifest.json`, which is what makes
 * Bay provision a SQLite file, add `data/` to the sandbox's writable paths, and
 * include the app in the backup schedule. Nothing here mentions Bay.
 */
export class VisitsApi {
  visits = $repository(visitEntity);

  visit = $action({
    schema: {
      response: z.object({ count: z.integer() }),
    },
    handler: async () =>
      await this.visits.upsert(
        { name: "home", count: 1 },
        {
          target: ["name"],
          set: { count: sql`${this.visits.table.count} + 1` },
        },
      ),
  });
}

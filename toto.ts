import { $hook, run, t } from "@alepha/core";
import { $repository, pg } from "@alepha/postgres";
import { dayjs } from "@alepha/datetime";

class App {
  users = $repository({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(),
      name: t.optional(t.text()),
      now: t.optional(t.datetime()),
    }),
  })

  ready = $hook({
    on: "ready",
    handler: async () => {
      const it = await this.users.create({
        name: "Alice",
        now: undefined
      });
      console.log(it)
    }
  })
}

run(App, {
  env: {
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres",
    POSTGRES_SCHEMA: "test",
    POSTGRES_SYNCHRONIZE: true
  }
})

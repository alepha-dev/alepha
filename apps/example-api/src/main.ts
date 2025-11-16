import { $hook, run, t } from "alepha";
import { $batch } from "alepha/batch";
import { $entity, $repository, pg } from "alepha/orm";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

const tasks = $entity({
  name: "tasks",
  schema: t.object({
    id: pg.primaryKey(),
    title: t.text(),
  }),
});

class App {
  docs = $swagger();
  tasks = $repository(tasks);

  batch = $batch({
    schema: t.object({
      title: t.text(),
    }),
    handler: async (items) => {
      // Create a new task
      console.log("batch handler called with items:", items);
      await this.tasks.createMany(items);
    },
    maxSize: 5,
    maxDuration: [10, "seconds"],
  });

  hello = $action({
    method: "GET",
    path: "/hello",
    schema: {
      response: t.string(),
    },
    handler: async () => {
      return "Hello, World!";
    },
  });

  ready = $hook({
    on: "ready",
    handler: async () => {
      for (let i = 0; i < 12; i++) {
        await this.batch.push({ title: `Initial Task ${i + 1}` });
        console.log(`Pushed Initial Task ${i + 1}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Fetch all tasks
      const allTasks = await this.tasks.findMany();
      console.log("All Tasks:", allTasks);
    },
  });
}

run(App, {
  env: {
    DATABASE_URL: "sqlite://node_modules/.alepha/db.sqlite",
  },
});

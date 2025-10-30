import { $hook, Alepha, t } from "@alepha/core";
import { $repository, pg } from "@alepha/postgres";
import { $page } from "@alepha/react";
import { $action, HttpClient, ServerProvider } from "@alepha/server";
import { $client } from "@alepha/server-links";
import { describe, it } from "vitest";

describe("React SSR Integration", () => {
  class Api {
    repository = $repository({
      name: "tasks",
      schema: t.object({
        id: pg.primaryKey(t.uuid()),
        name: t.text(),
      }),
    });

    ready = $hook({
      on: "ready",
      handler: async () => {
        await this.repository.deleteMany();
        await this.repository.createMany([
          { name: "Task 1" },
          { name: "Task 2" },
          { name: "Task 3" },
        ]);
      },
    });

    tasks = $action({
      schema: {
        response: t.array(this.repository.entity.schema),
      },
      handler: async () => {
        return this.repository.find();
      },
    });
  }

  class App {
    api = $client<Api>();
    home = $page({
      path: "/tasks",
      resolve: async () => ({
        tasks: await this.api.tasks(),
      }),
      component: ({ tasks }) => {
        return tasks.map((it) => it.name).join(",");
      },
    });
  }

  it("should render page with data from API", async ({ expect }) => {
    process.env.DATABASE_URL = "sqlite://:memory:";
    const alepha = Alepha.create();
    alepha.with(Api);
    alepha.with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);
    const response = await http.fetch(`${server.hostname}/tasks`);

    expect(response.data).toContain(
      '<div id="root">Task 1,Task 2,Task 3</div>',
    );
  });
});

export const snippets = {
  api: {
    filename: "src/Api.ts",
    content: `
import { z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { $action } from "alepha/server";

const taskEntity = $entity({
  name: "tasks",
  schema: z.object({
    id: db.primaryKey(),
    title: z.text(),
    done: db.default(z.boolean(), false),
  }),
});

export class Api {
  tasks = $repository(taskEntity);

  list = $action({
    schema: { response: z.array(taskEntity.schema) },
    handler: () => this.tasks.findMany({ limit: 20 }),
  });
}
`,
  },
  web: {
    uncheckable:
      "an excerpt: it imports `./Api.ts`, the file the `api` snippet beside it defines, which exists only in the reader's project",
    filename: "src/AppRouter.tsx",
    content: `
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { Api } from "./Api.ts";

export class AppRouter {
  api = $client<Api>();

  home = $page({
    path: "/",
    loader: async () => ({
      tasks: await this.api.list(),
    }),
    component: (props) => (
      <ul>
        {props.tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    ),
  });
}
`,
  },
  platform: {
    uncheckable:
      "an excerpt of `alepha.config.ts`, shown without its `defineConfig` / `platform` imports so the shape is what the reader sees",
    filename: "alepha.config.ts",
    content: `
export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "cloudflare",
          domain: "lore.alepha.dev",
        },
        staging: {
          adapter: "bay",
          host: "deploy@bay.example.com",
        },
      },
    }),
  ],
});
`,
  },
  test: {
    uncheckable:
      "an excerpt: `Alepha` and `EmailProvider` are shown unimported so the four lines that matter are the four lines on screen",
    filename: "tasks.spec.ts",
    content: `
const alepha = Alepha.create()
  .with({ provide: EmailProvider, use: MemoryEmailProvider });

const email = alepha.inject(MemoryEmailProvider);
const time = alepha.inject(DateTimeProvider);
await alepha.start();

await time.travel([1, "day"]);

expect(email.records).toHaveLength(1);
`,
  },
};

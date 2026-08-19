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
    done: z.boolean({ default: false }),
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
  infra: {
    filename: "src/Jobs.ts",
    content: `
import { z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $cache } from "alepha/cache";
import { $storage } from "alepha/orm";

export class Jobs {
  avatars = $storage({ name: "avatars" });

  stats = $cache({
    ttl: "5m",
    handler: async () => this.expensiveQuery(),
  });

  // queue-mode: await this.sendEmail.push({ to, body })
  sendEmail = $job({
    schema: z.object({ to: z.email(), body: z.text() }),
    handler: async ({ payload }) => this.mailer.send(payload),
  });

  // cron-mode: same primitive, "cron" replaces "schema"
  digest = $job({
    cron: "0 8 * * *",
    handler: async () => this.buildDigest(),
  });
}
`,
  },
  platform: {
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

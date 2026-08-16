export const snippets = {
  server: {
    filename: "Build type-safe HTTP APIs with automatic validation and OpenAPI",
    content: `
import { run } from "alepha";
import { $action } from "alepha/server";

class Api {
  // accessible via HTTP GET /api/greet?name=John
  greet = $action({
    schema: {
      query: z.object({ name: z.text() }),
      response: z.object({ greeting: z.string() }),
    },
    handler: async ({ query }) => {
      return {
        greeting: \`Hello, \${query.name}!\`,
      };
    },
  });
}

run(Api);
`,
  },
  react: {
    filename:
      "Create React apps with built-in Server-Side Rendering and data fetching",
    content: `
import { run } from "alepha";
import { $page } from "alepha/react/router";

const HelloComponent = (props: { message: string }) => {
  return <h1>{props.message}</h1>;
}

class App {
  home = $page({
    path: '/',
    // fetch data before rendering the page
    loader: async () => ({
      message: "Welcome to Alepha!"
    }),
    component: HelloComponent,
  });
}

run(App);
`,
  },
  db: {
    filename:
      "Define database entities with Drizzle ORM and type-safe repositories",
    content: `
import { z, run } from "alepha";
import { $entity, db, $repository } from "alepha/orm";

// define an entity with a schema
export const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    email: z.email(),
  })
});

class App {
  userRepository = $repository(userEntity);
  // userRepository.findMany(), ...
}

run(App);
`,
  },
  job: {
    filename: "Durable background jobs with retries, cron and crash recovery",
    content: `
import { z, run, $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { EmailProvider } from "alepha/email";

class App {
  email = $inject(EmailProvider);
  // queue-mode: await this.sendEmail.push(payload)
  sendEmail = $job({
    schema: z.object({ to: z.email(), body: z.text() }),
    handler: async ({ payload }) =>
      this.email.send(payload.to, payload.body)
  });
  // cron-mode: same primitive, "cron" replaces "schema"
  digest = $job({
    cron: "0 8 * * *", handler: async () => {}
  });
}

run(App);
`,
  },
  command: {
    filename: "Create powerful CLI commands with beautiful terminal output",
    content: `
import { z, run } from "alepha";
import { $command } from "alepha/command";

class App {
  deploy = $command({
    aliases: ["d"],
    schema: z.object({
    	env: z.enum(["staging", "prod"]),
    }),
    handler: async ({ run, flags }) => {
      await run("npx alepha test");
      await run("npx alepha build");
      const prod = flags.env === "prod" ? " --prod" : "";
      await run(\`cd dist && npx vercel$\{prod}\`);
    }
  });
}

run(App);
`,
  },
};

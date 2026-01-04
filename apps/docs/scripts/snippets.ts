export const snippets = {
  server: `
import { run } from "alepha";
import { $action } from "alepha/server";

class Api {
  // define a type-safe API action
  // accessible via HTTP GET /api/greet?name=John
  greet = $action({
    schema: {
      query: t.object({ name: t.text() }),
      response: t.object({ greeting: t.string() }),
    },
    handler: async ({ query }) => ({
      greeting: \`Hello, \${query.name}!\`,
    }),
  });
}

run(Api);
`,
  react: `
import { run } from "alepha";
import { $page } from "@alepha/react/router";

const HelloComponent = (props: { message: string }) => {
  return <h1>{props.message}</h1>;
}

class App {
  home = $page({
    path: '/',
    // fetch data before rendering the page
    resolve: async () => ({
      message: "Welcome to Alepha!"
    }),
    component: HelloComponent,
  });
}

run(App);
`,
  db: `
import { t, run } from "alepha";
import { $entity, db, $repository } from "alepha/orm";

// define an entity with a schema
export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
  })
});

class App {
  userRepository = $repository(userEntity);
  // userRepository.findMany(), ...
}

run(App);
`,
  queue: `
import { t, run } from "alepha";
import { $queue } from "alepha/queue";
import { EmailProvider } from "alepha/email";

class App {
  email = $inject(EmailProvider);

  sendEmail = $queue({
    schema: t.object({
      to: t.email(), subject: t.text(), body: t.string()
    }),
    handler: async ({ payload }) => {
      const { to, subject, body } = payload;
      await this.email.send(to, subject, body);
    }
  });
}

run(App);
`,
  command: `
import { t, run } from "alepha";
import { $command } from "alepha/command";

class App {
  deploy = $command({
    aliases: ["d"],
    schema: t.object({
    	env: t.enum(["staging", "prod"]),
    }),
    handler: async ({ run, flags }) => {
      await run("npx alepha build");

      const prod = flags.env === "prod" ? " --prod" : "";
      await run(\`cd dist && npx vercel$\{prod}\`);
    }
  });
}

run(App);
`,
};

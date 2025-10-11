export const snippets = {
	server: `
import { run } from "alepha";
import { $action } from "alepha/server";

class Api {
  // define a type-safe API action
  // accessible via HTTP GET /api/greet?name=John
  greet = $action({
    schema: { query: t.object({ name: t.text() }) },
    handler: async ({ query }) => \`Hello, \${query.name}!\`,
  });
}

run(Api);
`,
	react: `
import { run } from "alepha";
import { $page } from "alepha/react";

class App {
  // define a type-safe React page (both server and client)
  home = $page({
    path: '/',
    // fetch data before rendering the page
    resolve: async () => ({ message: "Welcome to Alepha!" }),
    component: ({ message }) => <h1>{message}</h1>,
  });
}

run(App);
`,
	db: `
import { t, run } from "alepha";
import { $entity, pg, $repository } from "alepha/postgres";

// define an entity with a schema
export const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
  })
});

class App {
  userRepository = $repository(users);
}
`,
	queue: `
import { t, run } from "alepha";
import { $queue } from "alepha/queue";

class App {
  sendEmail = $queue({
    schema: t.object({
      email: t.text()
    }),
    handler: async ({ payload }) => { /* worker */ }
  });
}

run(App);
`,
	command: `
import { t, run } from "alepha";
import { $command } from "alepha/command";

class CLI {
  build = $command({
    schema: t.object({
    	verbose: t.optional(t.boolean()),
    }),
    handler: () => { }
  });
}

run(CLI);
`,
};

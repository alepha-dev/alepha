export const snippets = {
	server: `
import { run } from "alepha";
import { $action } from "alepha/server";

class Api {
  // Define an API endpoint with a single descriptor.
  // Type-safe inputs and outputs are inferred automatically.
  greet = $action({
    schema: { query: t.object({ name: t.string() }) },
    handler: ({ query }) => \`Hello, \${query.name}!\`,
  });
}

run(Api);
`,
	react: `
import { run } from "alepha";
import { $page } from "alepha/react";

class App {
  // Define a server-side rendered React page.
  // Data from \`resolve\` is passed as type-safe props.
  home = $page({
    path: '/',
    resolve: async () => ({ message: "Welcome to Alepha!" }),
    component: ({ message }) => <h1>{message}</h1>,
  });
}

run(App);
`,
	db: `
import { t, run } from "alepha";
import { $entity, pg, $repository } from "alepha/postgres";

// Define an entity with type-safe columns.
export const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.string(),
  })
});

class App {
  userRepository = $repository(users);
}
`,
	queue: `
import { t, run } from "alepha";
import { $queue } from "alepha/queue";

class Queue {
  sendEmail = $queue({
    schema: t.object({
        email: t.string()
    }),
    handler: () => { /* worker */ }
  });
}

run(Queue);
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

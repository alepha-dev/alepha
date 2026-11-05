import { z } from "alepha";
import { $action, $route } from "alepha/server";

const USERS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `User number ${i + 1}`,
  email: `user${i + 1}@example.com`,
  age: 20 + (i % 50),
}));

/**
 * Hello world API used to benchmark the request path.
 */
export class HelloApi {
  ping = $route({
    method: "GET",
    path: "/ping",
    handler: () => "pong",
  });

  hello = $action({
    method: "GET",
    path: "/hello",
    schema: {
      response: z.object({ message: z.text() }),
    },
    handler: () => ({ message: "Hello, world!" }),
  });

  getUser = $action({
    method: "GET",
    path: "/users/:id",
    schema: {
      params: z.object({ id: z.integer() }),
      query: z.object({ expand: z.boolean().optional() }),
      response: z.object({
        id: z.integer(),
        name: z.text(),
        expand: z.boolean(),
      }),
    },
    handler: ({ params, query }) => ({
      id: params.id,
      name: `user ${params.id}`,
      expand: query.expand ?? false,
    }),
  });

  listUsers = $action({
    method: "GET",
    path: "/users",
    schema: {
      response: z.array(
        z.object({
          id: z.integer(),
          name: z.text(),
          email: z.text(),
          age: z.integer(),
        }),
      ),
    },
    handler: () => USERS,
  });

  createUser = $action({
    method: "POST",
    path: "/users",
    schema: {
      body: z.object({
        name: z.text(),
        email: z.text(),
        age: z.integer(),
      }),
      response: z.object({
        id: z.integer(),
        name: z.text(),
        email: z.text(),
        age: z.integer(),
      }),
    },
    handler: ({ body }) => ({ id: 1, ...body }),
  });
}

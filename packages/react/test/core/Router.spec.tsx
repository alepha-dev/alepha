import { Alepha, t } from "alepha";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { NestedView } from "../../src/router/index.ts";
import { ReactBrowserRouterProvider } from "../../src/router/providers/ReactBrowserRouterProvider.ts";

const setup = () => {
  const alepha = Alepha.create();
  const router = alepha.inject(ReactBrowserRouterProvider);

  const render = async (path: string): Promise<string> => {
    await router.transition(new URL(`http://localhost${path}`));
    const state = alepha.store.get("alepha.react.router.state");
    if (!state) {
      throw new Error(
        "Router state not found. Ensure the router is properly configured.",
      );
    }
    const element = router.root(state);
    return renderToString(element).replaceAll("<!-- -->", "");
  };

  return {
    router,
    render,
    alepha,
  };
};

test("Router - Basic", async ({ expect }) => {
  const { router, render, alepha } = setup();

  router.add({
    name: "Test",
    path: "/",
    component: () => "Hey",
  });

  router.add({
    name: "NotFound",
    path: "/*",
    component: () => "Not Found",
  });

  await alepha.start();

  expect(await render("/")).toEqual("Hey");
  expect(await render("/zz")).toEqual("Not Found");
});

test("Router - NestedView", async ({ expect }) => {
  const { router, render, alepha } = setup();

  router.add({
    name: "Test",
    component: () => (
      <>
        ((
        <NestedView />
        ))
      </>
    ),
    children: [
      {
        name: "Home",
        path: "/",
        component: () => "Home",
      },
      {
        name: "Hello",
        path: "/hello/:name",
        schema: {
          params: t.object({
            name: t.text(),
          }),
        },
        resolve: ({ params }) => params,
        component: (props) => `Hello, ${props.name}!`,
      },
    ],
  });

  await alepha.start();

  expect(await render("/")).toEqual("((Home))");
  expect(await render("/hello/jack")).toEqual("((Hello, jack!))");
});

test("Router - All routes", async ({ expect }) => {
  const { router, render, alepha } = setup();

  router.add({
    children: [
      {
        path: "/*",
        component: () => "404",
      },
      {
        component: () => "home",
      },
      {
        path: "about",
        component: () => "about",
      },
      {
        path: "sub",
        children: [
          {
            component: () => "a",
          },
          {
            path: "b",
            component: () => "b",
          },
        ],
      },
      {
        path: "users",
        component: () => <NestedView>yo</NestedView>,
        children: [
          {
            path: "new",
            component: () => "users/new",
          },
          {
            path: ":id",
            schema: { params: t.object({ id: t.text() }) },
            resolve: ({ params }) => {
              if (params.id === "boom") throw new Error("boom");
              return params;
            },
            children: [
              {
                resolve: ({ params }) => params,
                component: ({ id }) => `hey ${id}`,
              },
              {
                path: "profile",
                resolve: ({ params }) => params,
                component: ({ id }) => `profile of ${id}`,
              },
            ],
          },
        ],
        errorHandler: (error) => {
          return `Error: ${error.message}`;
        },
      },
    ],
  });

  await alepha.start();

  expect(await render("/")).toEqual("home");
  expect(await render("/about")).toEqual("about");
  expect(await render("/noop")).toEqual("404");
  expect(await render("/noop/noop")).toEqual("404");
  expect(await render("/sub")).toEqual("a");
  expect(await render("/sub/")).toEqual("a");
  expect(await render("/sub/b")).toEqual("b");
  expect(await render("/sub/noop")).toEqual("404");
  expect(await render("/users")).toEqual("yo");
  expect(await render("/users/")).toEqual("yo");
  expect(await render("/users/a")).toEqual("hey a");
  expect(await render("/users/boom")).toEqual("Error: boom");
  expect(await render("/users/new")).toEqual("users/new");
  expect(await render("/users/hey/ho")).toEqual("404");
  expect(await render("/users/a/profile")).toEqual("profile of a");
});

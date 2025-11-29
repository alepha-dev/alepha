import { Alepha, t } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { $proxy } from "alepha/server/proxy";
import { describe, expect, it } from "vitest";

describe("$proxy", () => {
  it("should proxy requests to target server with headers and query params", async () => {
    class App {
      hello = $action({
        schema: {
          headers: t.object({
            prefix: t.optional(t.text()),
          }),
          query: t.object({
            transform: t.optional(t.enum(["uppercase"])),
          }),
          body: t.object({
            name: t.text(),
          }),
          response: t.object({
            message: t.text(),
          }),
        },
        handler: ({ body, query, headers, reply }) => {
          let name = body.name;
          if (query.transform === "uppercase") {
            name = name.toUpperCase();
          }
          if (headers.prefix) {
            name = `${headers.prefix}${name}`;
          }
          reply.headers["x-hello"] = "world";
          return {
            message: `Hello ${name}!`,
          };
        },
      });
    }

    const alephaApi = Alepha.create({
      env: {
        APP_NAME: "API",
      },
    }).with(App);

    class AppProxy {
      proxy = $proxy({
        path: "/api/*",
        target: () => alephaApi.inject(ServerProvider).hostname,
      });
    }

    const alephaProxy = Alepha.create({
      env: {
        APP_NAME: "PROXY",
      },
    }).with(AppProxy);

    await alephaApi.start();
    await alephaProxy.start();

    for (let i = 0; i < 10; i++) {
      const hostname = alephaProxy.inject(ServerProvider).hostname;

      const response = await fetch(
        `${hostname}/api/hello?transform=uppercase`,
        {
          method: "POST",
          body: JSON.stringify({ name: "Jack" }),
          headers: {
            "Content-Type": "application/json",
            prefix: "Mr.",
          },
        },
      );

      expect(response.status).toBe(200);

      const json = await response.json();

      expect(response.headers.get("x-hello")).toBe("world");
      expect(json).toEqual({
        message: "Hello Mr.JACK!",
      });
    }
  });
});

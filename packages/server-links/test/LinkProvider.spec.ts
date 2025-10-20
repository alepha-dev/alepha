import { Alepha, t } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { describe, it } from "vitest";
import { LinkProvider, ServerLinksProvider } from "../src";

class App {
  ping = $action({
    schema: {
      response: t.object({
        pong: t.boolean(),
      }),
    },
    handler: () => {
      return { pong: true };
    },
  });
}

describe("LinkProvider", () => {
  it("should execute action through local handler", async ({ expect }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const app = alepha.inject(LinkProvider).client<App>();

    expect(await app.ping()).toStrictEqual({ pong: true });
  });

  it("should expose links endpoint with available actions", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );

    expect(await res.json()).toStrictEqual({
      prefix: "/api",
      links: [
        {
          group: "App",
          name: "ping",
          path: "/ping",
        },
      ],
    });
  });
});

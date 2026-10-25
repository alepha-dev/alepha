import { Alepha } from "alepha";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A web-stream body on a socket that has no `setNoDelay`.
 *
 * Deno runs an Alepha `node` build through its `node:http` shim, whose
 * `res.socket` lacks `setNoDelay`. The streaming branch of
 * `handleNodeRequest` called it unconditionally, so every SSR page (a
 * `ReadableStream` body) answered 500 under Deno while static assets served
 * fine. Here the method is shadowed on the one socket, which is what Deno
 * hands the provider.
 */
describe("ServerProvider on a socket without setNoDelay", () => {
  it("should stream a ReadableStream body", async ({ expect }) => {
    class App {
      stream = $route({
        path: "/stream",
        handler: ({ reply, raw }) => {
          const socket = raw.node?.res.socket as any;
          socket.setNoDelay = undefined;
          reply.setHeader("content-type", "text/plain");
          reply.body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("hello "));
              controller.enqueue(new TextEncoder().encode("deno"));
              controller.close();
            },
          });
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const res = await fetch(`${hostname}/stream`, {
      headers: { connection: "close" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello deno");
  });
});

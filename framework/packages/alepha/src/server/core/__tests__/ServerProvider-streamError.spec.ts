import { Readable } from "node:stream";

import { Alepha, AlephaError } from "alepha";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

describe("ServerProvider streaming errors", () => {
  it("should survive a Readable body that fails mid-stream", async ({
    expect,
  }) => {
    // `readable.pipe(res)` does not forward source errors: on failure it just
    // unpipes and leaves the response open, so the client waits forever and
    // the socket leaks. Reachable from any fs-backed body (deleted file, disk
    // fault). The client must learn the response is broken.
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);

    try {
      class App {
        broken = $route({
          path: "/broken",
          handler: ({ reply }) => {
            const body = new Readable({ read() {} });
            body.push("first chunk");
            setTimeout(() => body.destroy(new Error("disk is gone")), 5);
            reply.setHeader("content-type", "text/plain");
            reply.body = body;
          },
        });

        ok = $route({
          path: "/ok",
          handler: () => "ok",
        });
      }

      const alepha = Alepha.create().with(App).with(AlephaServer);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      // The client sees a truncated response: that part is unavoidable once
      // headers are out. What matters is that it settles instead of hanging,
      // and that the server stays up.
      const outcome = await fetch(`${hostname}/broken`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((res) => res.text())
        .then(() => "completed" as const)
        .catch((error: any) =>
          error?.name === "TimeoutError"
            ? ("hung" as const)
            : ("failed" as const),
        );

      expect(outcome).toBe("failed");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(uncaught).toEqual([]);

      const res = await fetch(`${hostname}/ok`);
      expect(res.status).toBe(200);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("should break the connection when a web stream body fails mid-stream", async ({
    expect,
  }) => {
    // The same failure on a web `ReadableStream` (a server render that
    // crashes after its shell went out). Ending the response normally would
    // hand the client a well-formed 200 with a truncated body and nothing to
    // tell it apart from a complete one.
    class App {
      broken = $route({
        path: "/broken",
        handler: ({ reply }) => {
          let pulls = 0;
          reply.setHeader("content-type", "text/plain");
          reply.body = new ReadableStream({
            async pull(controller) {
              if (pulls++ === 0) {
                controller.enqueue(new TextEncoder().encode("first chunk"));
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 20));
              controller.error(new AlephaError("render crashed"));
            },
          });
        },
      });

      ok = $route({
        path: "/ok",
        handler: () => "ok",
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    // `identity`: a compressed body goes through the compressor's Node
    // stream, which is the other path.
    const outcome = await fetch(`${hostname}/broken`, {
      headers: { "accept-encoding": "identity" },
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => res.text())
      .then((text) => `completed: ${text}`)
      .catch((error: any) =>
        error?.name === "TimeoutError" ? "hung" : "failed",
      );

    expect(outcome).toBe("failed");

    const res = await fetch(`${hostname}/ok`);
    expect(res.status).toBe(200);
  });

  it("should answer 500 when a web stream body fails before its first chunk", async ({
    expect,
  }) => {
    // Nothing is sent yet, so the failure can still be told the plain way,
    // with a status, instead of a 200 that breaks off.
    class App {
      early = $route({
        path: "/early",
        handler: ({ reply }) => {
          reply.setHeader("content-type", "text/plain");
          reply.body = new ReadableStream({
            pull(controller) {
              controller.error(new AlephaError("render crashed"));
            },
          });
        },
      });

      late = $route({
        path: "/late",
        handler: ({ reply }) => {
          let pulls = 0;
          reply.setHeader("content-type", "text/plain");
          reply.body = new ReadableStream({
            async pull(controller) {
              // A first chunk that takes its time does not hold the head.
              await new Promise((resolve) => setTimeout(resolve, 30));
              if (pulls++ === 0) {
                controller.enqueue(new TextEncoder().encode("late chunk"));
              } else {
                controller.close();
              }
            },
          });
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;
    const headers = { "accept-encoding": "identity" };

    const early = await fetch(`${hostname}/early`, { headers });
    expect(early.status).toBe(500);
    expect(await early.text()).toBe("Internal Server Error");

    const late = await fetch(`${hostname}/late`, { headers });
    expect(late.status).toBe(200);
    expect(await late.text()).toBe("late chunk");
  });
});

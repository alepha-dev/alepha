import { Readable } from "node:stream";
import { Alepha } from "alepha";
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

      // The client sees a truncated response — that part is unavoidable once
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
});

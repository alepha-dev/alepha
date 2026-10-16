import { $hook, AbortedError, Alepha } from "alepha";
import type { LogEntry } from "alepha/logger";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A request cut short by its client is an outcome, not an error (#E85):
 * no `server:request:error` (the hook every reporter listens to), no
 * error-level log entry (what a blight is raised from), one debug line.
 */
describe("ServerRouterProvider aborted requests", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  const setup = async (
    handler: (signal: AbortSignal) => Promise<string | undefined>,
  ) => {
    const errors: unknown[] = [];
    const entries: LogEntry[] = [];
    const responses: number[] = [];
    const settled = deferred();

    class App {
      slow = $route({
        path: "/slow",
        handler: async ({ signal }) => {
          try {
            return await handler(signal);
          } finally {
            settled.resolve();
          }
        },
      });
      onError = $hook({
        on: "server:request:error",
        handler: ({ error }) => {
          errors.push(error);
        },
      });
      onResponse = $hook({
        on: "server:response:after",
        handler: ({ response }) => {
          responses.push(response.status);
        },
      });
      onLog = $hook({
        on: "log:entry",
        handler: ({ entry }) => {
          entries.push(entry);
        },
      });
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "debug" } })
      .with(App)
      .with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;
    return { alepha, hostname, errors, entries, responses, settled };
  };

  it("never emits server:request:error for a disconnect, logs one debug line with 499, and nothing at error level", async ({
    expect,
  }) => {
    const started = deferred();
    const { hostname, errors, entries, responses, settled } = await setup(
      (signal) => {
        started.resolve();
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );

    const client = new AbortController();
    const response = fetch(`${hostname}/slow`, { signal: client.signal });
    await started.promise;
    client.abort();
    await response.catch(() => undefined);
    await settled.promise;
    // processRequest finishes after the handler settled: wait for its line
    // rather than a fixed delay, which races a loaded machine.
    const deadline = Date.now() + 2000;
    while (
      Date.now() < deadline &&
      !entries.some((it) => it.message.includes("499"))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(errors).toEqual([]);
    expect(responses).toEqual([]);
    expect(entries.filter((it) => it.level === "ERROR")).toEqual([]);
    const lines = entries.filter((it) => it.message.includes("499"));
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("DEBUG");
    expect(lines[0].message).toContain("Client disconnected");
  });

  it("still reports a real error thrown after an unrelated abort elsewhere", async ({
    expect,
  }) => {
    const { hostname, errors, settled } = await setup(async () => {
      const elsewhere = new AbortController();
      elsewhere.abort(new AbortedError("someone else's work"));
      throw new Error("boom");
    });

    const res = await fetch(`${hostname}/slow`);
    await settled.promise;

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });

  it("still reports an AbortError from the handler's own work while the client is there", async ({
    expect,
  }) => {
    const { hostname, errors, settled } = await setup(async () => {
      const own = new AbortController();
      own.abort(new AbortedError("the handler's own fetch"));
      own.signal.throwIfAborted();
    });

    const res = await fetch(`${hostname}/slow`);
    await settled.promise;

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
  });
});

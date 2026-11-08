import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { MemoryTraceProvider } from "alepha/tracing";
import { describe, it } from "vitest";

import { ServerLinksProvider } from "../index.ts";

describe("POST /api/_batch tracing", () => {
  it("shows one action child per batched action under the request root", async ({
    expect,
  }) => {
    class App {
      ping = $action({
        path: "/ping",
        method: "GET",
        schema: { response: z.text() },
        handler: () => "pong",
      });
      echo = $action({
        method: "POST",
        path: "/echo",
        schema: { body: z.object({ message: z.text() }), response: z.text() },
        handler: ({ body }) => body.message,
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    const traces = alepha.inject(MemoryTraceProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { action: "ping" },
          { action: "echo", body: { message: "hi" } },
          { action: "ping" },
        ]),
      },
    );
    await res.json();

    const root = traces.find("POST /api/_batch")!;
    expect(root).toBeDefined();
    const actions = traces
      .trace(root.traceId)
      .filter((s) => s.name.startsWith("action "));
    expect(actions.map((s) => s.name).toSorted()).toEqual([
      "action echo",
      "action ping",
      "action ping",
    ]);
    for (const action of actions) {
      expect(action.traceId).toBe(root.traceId);
    }
  });
});

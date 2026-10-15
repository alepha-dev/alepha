import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { renderHook } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaHttpClient, HttpClient, HttpError } from "alepha/server";
import { act, type ReactNode } from "react";
import { afterEach, describe, expectTypeOf, it } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { type RunResult, useAction } from "../hooks/useAction.ts";

const QuotaExceeded = HttpError.extend({
  name: "QUOTA_EXCEEDED",
  default: { status: 409 },
  schema: z.object({ limit: z.number(), used: z.number() }),
});

/**
 * A page calling a strict action branches on its declared errors with
 * `instanceof` (#Q2711). `RunResult`'s error stays `Error`: the class
 * `HttpClient` rebuilds from the response body is what narrows it.
 */
describe("useAction declared errors", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  /**
   * A real HTTP server answering the body a strict action writes for a
   * declared error, so the page sees exactly what crosses the wire.
   */
  const serve = async (): Promise<string> => {
    const body = JSON.stringify(
      HttpError.toJSON(new QuotaExceeded({ limit: 5, used: 6 })),
    );
    server = createServer((_req, res) => {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/createProject`;
  };

  const boot = async () => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaHttpClient);
    await alepha.start();
    const client = alepha.inject(HttpClient);
    const seen: Array<{ error: Error; handled?: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push({ error: event.error, handled: event.handled });
    });
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        {props.children}
      </AlephaContext.Provider>
    );
    return { client, seen, wrapper };
  };

  it("narrows result.error with instanceof and reads typed data", async ({
    expect,
  }) => {
    const url = await serve();
    const { client, wrapper } = await boot();
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              await client.fetch(url, { method: "POST" });
            },
            onError: () => {},
          },
          [],
        ),
      { wrapper },
    );

    let run: RunResult<void> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expectTypeOf<
      Extract<RunResult<void>, { reason: "error" }>["error"]
    >().toEqualTypeOf<Error>();

    let limit: number | undefined;
    if (run && !run.ok && run.reason === "error") {
      if (run.error instanceof QuotaExceeded) {
        expectTypeOf(run.error.data.limit).toEqualTypeOf<number>();
        expectTypeOf(run.error.data.used).toEqualTypeOf<number>();
        limit = run.error.data.limit;
      }
    }
    expect(limit).toBe(5);
  });

  it("narrows in onError, which marks the error handled", async ({
    expect,
  }) => {
    const url = await serve();
    const { client, seen, wrapper } = await boot();
    const limits: number[] = [];
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              await client.fetch(url, { method: "POST" });
            },
            onError: (error) => {
              if (error instanceof QuotaExceeded) {
                limits.push(error.data.limit);
              }
            },
          },
          [],
        ),
      { wrapper },
    );

    await act(async () => {
      await result.current.run();
    });

    expect(limits).toEqual([5]);
    // What a mounted ActionErrorToaster reads to stay quiet.
    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBeInstanceOf(QuotaExceeded);
    expect(seen[0].handled).toBe(true);
  });
});

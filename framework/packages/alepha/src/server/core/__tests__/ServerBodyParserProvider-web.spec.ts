import { Alepha, z } from "alepha";
import { beforeEach, describe, it } from "vitest";

import { $action, ServerProvider } from "../index.ts";
import { bodyParserOptions } from "../providers/ServerBodyParserProvider.ts";

/**
 * The body of a Web request (Bun, workerd), driven through
 * `handleWebRequest` as those runtimes' providers do.
 *
 * A request with a declared length is read with `arrayBuffer()` and never
 * through `.body`: building the ReadableStream and reading it chunk by chunk
 * in JS made POST on Bun cost 60% more CPU than Express doing the same job.
 * A request without one (chunked) still goes through the stream, which is
 * where the limit is counted as it arrives.
 */
class CountingRequest extends Request {
  public bodyReads = 0;

  public override get body() {
    this.bodyReads += 1;
    return super.body;
  }
}

class TestApp {
  create = $action({
    method: "POST",
    path: "/users",
    schema: {
      body: z.object({ name: z.text() }),
      response: z.object({ name: z.text() }),
    },
    handler: ({ body }) => ({ name: body.name }),
  });
}

describe("ServerBodyParserProvider on a Web request", () => {
  let alepha: Alepha;
  let server: ServerProvider;

  const send = async (req: Request) => {
    const ev = { req, res: undefined as Response | undefined };
    await server.handleWebRequest(ev);
    return ev.res as Response;
  };

  const post = (body: BodyInit, headers: Record<string, string>) =>
    new CountingRequest("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      duplex: "half",
    } as RequestInit);

  const chunked = (...chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

  beforeEach(async () => {
    alepha = Alepha.create().with(TestApp);
    alepha.store.mut(bodyParserOptions, (options) => ({
      ...options,
      limit: 100,
    }));
    await alepha.start();
    server = alepha.inject(ServerProvider);
  });

  it("reads a body of declared length without touching its stream", async ({
    expect,
  }) => {
    const text = JSON.stringify({ name: "Ada" });
    const req = post(text, { "content-length": String(text.length) });

    const res = await send(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Ada" });
    expect(req.bodyReads).toBe(0);
  });

  it("refuses a declared length over the limit with 413", async ({
    expect,
  }) => {
    const text = JSON.stringify({ name: "x".repeat(200) });
    const res = await send(
      post(text, { "content-length": String(text.length) }),
    );

    expect(res.status).toBe(413);
  });

  it("answers 400 for malformed JSON of declared length", async ({
    expect,
  }) => {
    const res = await send(post("{nope", { "content-length": "5" }));

    expect(res.status).toBe(400);
  });

  it("still reads a chunked body through its stream", async ({ expect }) => {
    const req = post(chunked('{"name":', '"Ada"}'), {});

    const res = await send(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Ada" });
    expect(req.bodyReads).toBeGreaterThan(0);
  });

  it("refuses a chunked body past the limit with 413", async ({ expect }) => {
    const res = await send(
      post(chunked('{"name":"', "x".repeat(200), '"}'), {}),
    );

    expect(res.status).toBe(413);
  });
});

import { Readable } from "node:stream";

import { AlephaError } from "alepha";
import { describe, it } from "vitest";

import { readRawBody, toWebRequest } from "../helpers/webRequest.ts";

/**
 * What the Node server hands a route: a readable request with its headers.
 */
const nodeRequest = (
  method: string,
  headers: Record<string, string | string[]>,
  chunks: Array<Buffer | string> = [],
) => ({
  node: {
    req: Object.assign(Readable.from(chunks, { objectMode: true }), {
      method,
      headers,
    }),
    res: undefined,
  },
});

describe("toWebRequest", () => {
  it("builds a web request from a Node request, with the bytes received", async ({
    expect,
  }) => {
    const raw = nodeRequest(
      "post",
      { "content-type": "text/plain", "x-tag": ["a", "b"] },
      [Buffer.from('{"a":'), "1}"],
    );

    const request = await toWebRequest(
      new URL("http://localhost/hook"),
      raw as any,
    );

    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://localhost/hook");
    expect(request.headers.get("content-type")).toBe("text/plain");
    expect(request.headers.get("x-tag")).toBe("a, b");
    expect(await request.text()).toBe('{"a":1}');
  });

  it("builds a bodiless web request for a GET", async ({ expect }) => {
    const request = await toWebRequest(
      new URL("http://localhost/hook"),
      nodeRequest("GET", { accept: "*/*" }) as any,
    );

    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
  });

  it("throws an AlephaError when the request has neither raw side", async ({
    expect,
  }) => {
    await expect(
      toWebRequest(new URL("http://localhost/hook"), {}),
    ).rejects.toBeInstanceOf(AlephaError);
  });

  it("returns the web request as is on a web-request runtime", async ({
    expect,
  }) => {
    const req = new Request("http://localhost/hook", { method: "POST" });
    const ev = { req, res: undefined };
    expect(await toWebRequest(new URL(req.url), { web: ev as any })).toBe(req);
  });
});

describe("readRawBody", () => {
  it("drains a Node request into the exact bytes received", async ({
    expect,
  }) => {
    const bytes = await readRawBody(
      nodeRequest("POST", {}, [
        Buffer.from([0x00, 0xff]),
        "é",
        Buffer.from([0x10]),
      ]) as any,
    );

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes!]).toEqual([0x00, 0xff, 0xc3, 0xa9, 0x10]);
  });

  it("reads a web request's bytes", async ({ expect }) => {
    const req = new Request("http://localhost/hook", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });

    expect([...(await readRawBody({ web: { req } }))!]).toEqual([1, 2, 3]);
  });

  it("is undefined when the request has neither raw side", async ({
    expect,
  }) => {
    expect(await readRawBody({})).toBeUndefined();
  });
});

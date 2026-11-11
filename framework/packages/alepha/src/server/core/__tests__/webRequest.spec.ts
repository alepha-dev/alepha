import { AlephaError } from "alepha";
import { describe, it } from "vitest";

import { readRawBody, toWebRequest } from "../helpers/webRequest.ts";

describe("toWebRequest", () => {
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
  it("is undefined when the request has neither raw side", async ({
    expect,
  }) => {
    expect(await readRawBody({})).toBeUndefined();
  });
});

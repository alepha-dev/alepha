import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $route, ServerProvider } from "../index.ts";

describe("server batch", () => {
  describe("requestId", () => {
    it("should be stable across accesses within one request", async () => {
      // The getter called getRequestId() unmemoized, so every access minted a
      // fresh randomUUID: the id logged, the id in the error body and the ids
      // read by middleware were all different, and none matched the ALS
      // context id — correlating a request across logs was impossible.
      class App {
        ids = $route({
          path: "/ids",
          // Accessed twice THROUGH the request object: destructuring would
          // evaluate the getter once and hide the bug.
          handler: (ctx: any) => `${ctx.requestId}|${ctx.requestId}`,
        });
      }

      const alepha = Alepha.create().with(App);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const body = await (await fetch(`${hostname}/ids`)).text();
      const [first, second] = body.split("|");

      expect(first).toBe(second);
    });

    it("should honour an inbound x-request-id", async () => {
      class App {
        id = $route({
          path: "/id",
          handler: ({ requestId }: any) => requestId,
        });
      }

      const alepha = Alepha.create().with(App);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const body = await (
        await fetch(`${hostname}/id`, {
          headers: { "x-request-id": "trace-me" },
        })
      ).text();

      expect(body).toBe("trace-me");
    });
  });

  describe("HSTS", () => {
    it("should emit HSTS for a request forwarded as https", async () => {
      // The check read `x-forwarded-proto` off the RESPONSE, which never
      // carries it — so it collapsed to isProduction(): HSTS went out over
      // plain HTTP in production and never went out over HTTPS anywhere else.
      class App {
        ping = $route({ path: "/ping", handler: () => "ok" });
      }

      const alepha = Alepha.create().with(App);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const secure = await fetch(`${hostname}/ping`, {
        headers: { "x-forwarded-proto": "https" },
      });
      expect(secure.headers.get("strict-transport-security")).toBeTruthy();

      const plain = await fetch(`${hostname}/ping`);
      expect(plain.headers.get("strict-transport-security")).toBeNull();
    });
  });

  describe("query parsing", () => {
    it("should keep a valueless key as an empty string", async () => {
      // The hand-rolled Node parser only recorded a pair when it saw `=`, so
      // `?flag` vanished — while URLSearchParams on Bun/workerd yields
      // `{ flag: "" }`. The same request reached different handlers on
      // different runtimes.
      class App {
        q = $route({
          path: "/q",
          schema: { query: z.object({ flag: z.text().optional() }) },
          handler: ({ query }) => JSON.stringify(query),
        });
      }

      const alepha = Alepha.create().with(App);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const body = await (await fetch(`${hostname}/q?flag`)).text();

      expect(JSON.parse(body)).toEqual({ flag: "" });
    });
  });
});

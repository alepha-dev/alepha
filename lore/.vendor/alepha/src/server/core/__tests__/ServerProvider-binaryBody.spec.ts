import { $hook, Alepha } from "alepha";
import { beforeEach, describe, it } from "vitest";

import { $route, ServerProvider } from "../index.ts";

/**
 * A binary reply body that is not a Node `Buffer`.
 *
 * `ServerResponse.body` has always admitted an `ArrayBuffer`, and the HEAD
 * path already measured one, but the serializer only recognised
 * `Buffer.isBuffer`: every other object fell into "plain object, serialise as
 * JSON". An `ArrayBuffer` went out as the two bytes `{}` under
 * `application/json`, and a `Uint8Array` as a JSON object of its indices.
 * Found during a Bun `--compile` spike (2026-09-10), where the body came from
 * a Web API that hands back an `ArrayBuffer`, not a `Buffer`.
 *
 * A body a hook sets after serialization reaches the server provider without
 * passing through the serializer at all, and the provider answered those with
 * a 500 ("Unknown response body type"), so both layers are covered here.
 *
 * `BunHttpServerProvider.bun.spec.ts` runs the same round-trips on Bun, whose
 * provider writes through `handleWebRequest` rather than `handleNodeRequest`.
 */
class TestApp {
  arrayBuffer = $route({
    path: "/array-buffer",
    handler: ({ reply }) => {
      reply.body = new TextEncoder().encode("hello").buffer;
    },
  });

  uint8Array = $route({
    path: "/uint8-array",
    handler: ({ reply }) => {
      reply.body = new TextEncoder().encode("hello");
    },
  });

  /**
   * A window onto a larger buffer. Anything that reaches for `view.buffer`
   * instead of honouring `byteOffset` / `byteLength` sends `[hello]`.
   */
  subarray = $route({
    path: "/subarray",
    handler: ({ reply }) => {
      reply.body = new TextEncoder().encode("[hello]").subarray(1, 6);
    },
  });

  /**
   * An `ArrayBufferView` that is not a typed array: `new Uint8Array(view)`
   * reads it as an empty array-like, so a copy that way sends nothing.
   */
  dataView = $route({
    path: "/data-view",
    handler: ({ reply }) => {
      reply.body = new DataView(
        new TextEncoder().encode("[hello]").buffer,
        1,
        5,
      );
    },
  });

  declaredType = $route({
    path: "/declared-type",
    handler: ({ reply }) => {
      reply.headers["content-type"] = "image/png";
      reply.body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    },
  });

  hookArrayBuffer = $route({
    path: "/hook-array-buffer",
    handler: () => "replaced by the hook",
  });

  hookSubarray = $route({
    path: "/hook-subarray",
    handler: () => "replaced by the hook",
  });

  /**
   * Replaces the body after `serializeResponse` ran, so what it sets is what
   * the server provider receives.
   *
   * It replaces the content-type as well, and has to: the handler's string
   * left `text/plain`, which `ServerCompressProvider` compresses, and the
   * compressor turns an `ArrayBuffer` into a `Buffer` on its way through. With
   * the type left alone, the `ArrayBuffer` case passed with the provider
   * still broken.
   */
  onSend = $hook({
    on: "server:onSend",
    handler: ({ request }) => {
      const path = request.url.pathname;
      if (path === "/hook-array-buffer") {
        request.reply.headers["content-type"] = "application/octet-stream";
        request.reply.body = new TextEncoder().encode("hello").buffer;
      } else if (path === "/hook-subarray") {
        request.reply.headers["content-type"] = "application/octet-stream";
        request.reply.body = new TextEncoder().encode("[hello]").subarray(1, 6);
      }
    },
  });
}

describe("ServerProvider - binary bodies", () => {
  let hostname: string;

  beforeEach(async () => {
    const alepha = Alepha.create().with(TestApp);
    await alepha.start();
    hostname = alepha.inject(ServerProvider).hostname;
  });

  describe("set by the handler", () => {
    for (const path of ["/array-buffer", "/uint8-array"]) {
      it(`sends the bytes of ${path}, as application/octet-stream`, async ({
        expect,
      }) => {
        const response = await fetch(`${hostname}${path}`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello");
        expect(response.headers.get("content-type")).toBe(
          "application/octet-stream",
        );
      });
    }

    it("sends only the window of a subarray", async ({ expect }) => {
      const response = await fetch(`${hostname}/subarray`);

      expect(await response.text()).toBe("hello");
    });

    it("sends the bytes of a DataView", async ({ expect }) => {
      const response = await fetch(`${hostname}/data-view`);

      expect(await response.text()).toBe("hello");
    });

    it("keeps a content-type the handler declared", async ({ expect }) => {
      const response = await fetch(`${hostname}/declared-type`);

      expect(response.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
        0x89, 0x50, 0x4e, 0x47,
      ]);
    });
  });

  describe("set by a hook after serialization", () => {
    for (const path of ["/hook-array-buffer", "/hook-subarray"]) {
      it(`sends the bytes of ${path}`, async ({ expect }) => {
        const response = await fetch(`${hostname}${path}`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello");
      });

      it(`answers HEAD on ${path} with the byte length`, async ({ expect }) => {
        const response = await fetch(`${hostname}${path}`, { method: "HEAD" });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-length")).toBe("5");
      });
    }
  });
});

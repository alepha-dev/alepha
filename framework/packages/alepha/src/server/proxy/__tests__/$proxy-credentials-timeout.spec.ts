import { $hook, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $action, $route, ServerProvider } from "alepha/server";
import { $remote, ServerLinksProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { $proxy, type ProxyPrimitiveOptions } from "../index.ts";

/**
 * The `$proxy` credential default and its timeout (#Q3322): neither `Cookie`
 * nor `Authorization` reaches the upstream unless `forward` names it, and
 * `timeout` bounds the wait for the upstream's headers.
 */
describe("$proxy credentials and timeout", () => {
  /**
   * An upstream that reports the headers it received, holds `/hang`, and
   * streams `/slow` in two chunks with a pause between.
   */
  class Upstream {
    hit?: () => void;
    release?: () => void;

    echo = $route({
      path: "/echo",
      handler: ({ headers, reply }) => {
        reply.headers["content-type"] = "application/json";
        return JSON.stringify({
          cookie: headers.cookie ?? null,
          authorization: headers.authorization ?? null,
          other: headers["x-other"] ?? null,
        });
      },
    });

    hang = $route({
      path: "/hang",
      handler: async ({ signal }) => {
        this.hit?.();
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        return "late";
      },
    });

    slow = $route({
      path: "/slow",
      handler: ({ reply }) => {
        reply.headers["content-type"] = "text/plain";
        return new ReadableStream<Uint8Array>({
          start: async (controller) => {
            controller.enqueue(new TextEncoder().encode("first,"));
            await new Promise<void>((resolve) => {
              this.release = resolve;
              this.hit?.();
            });
            controller.enqueue(new TextEncoder().encode("second"));
            controller.close();
          },
        });
      },
    });
  }

  const start = async (options: Partial<ProxyPrimitiveOptions> = {}) => {
    const upstream = Alepha.create({ env: { APP_NAME: "UPSTREAM" } }).with(
      Upstream,
    );

    class Front {
      proxy = $proxy({
        path: "/up/*",
        target: () => upstream.inject(ServerProvider).hostname,
        rewrite: (url) => {
          url.pathname = url.pathname.replace("/up", "");
        },
        ...options,
      });

      // What `ServerAuthProvider` does for a signed-in browser: it derives
      // an `Authorization` from the session cookie before any handler runs.
      session = $hook({
        on: "server:request:before",
        handler: ({ request }) => {
          if (request.headers.cookie && !request.headers.authorization) {
            request.headers.authorization = "Bearer session-access-token";
          }
        },
      });
    }

    const front = Alepha.create({ env: { APP_NAME: "FRONT" } }).with(Front);
    await upstream.start();
    await front.start();
    const base = front.inject(ServerProvider).hostname;
    return { front, upstream, base, app: upstream.inject(Upstream) };
  };

  const echo = async (
    base: string,
    headers: Record<string, string> = { cookie: "session=abc" },
  ) => {
    const response = await fetch(`${base}/up/echo`, {
      headers: { "x-other": "kept", ...headers },
    });
    return (await response.json()) as Record<string, string | null>;
  };

  describe("credentials", () => {
    it("forwards neither the cookie nor the cookie-derived Authorization by default", async ({
      expect,
    }) => {
      const { base } = await start();

      expect(await echo(base)).toEqual({
        cookie: null,
        authorization: null,
        other: "kept",
      });
    });

    it("drops a client-sent Authorization too, whatever its case", async ({
      expect,
    }) => {
      const { base } = await start();

      expect(
        await echo(base, { Authorization: "Bearer client", Cookie: "a=b" }),
      ).toEqual({ cookie: null, authorization: null, other: "kept" });
    });

    it('lets forward: ["authorization"] through, and only it', async ({
      expect,
    }) => {
      const { base } = await start({ forward: ["authorization"] });

      expect(await echo(base)).toEqual({
        cookie: null,
        authorization: "Bearer session-access-token",
        other: "kept",
      });
    });

    it('lets forward: ["cookie", "authorization"] send both', async ({
      expect,
    }) => {
      const { base } = await start({ forward: ["cookie", "authorization"] });

      expect(await echo(base)).toEqual({
        cookie: "session=abc",
        authorization: "Bearer session-access-token",
        other: "kept",
      });
    });

    it("keeps an Authorization that beforeRequest sets: the removal runs before it", async ({
      expect,
    }) => {
      let seen: Record<string, string> | undefined;
      const { base } = await start({
        beforeRequest: (_request, proxyRequest) => {
          seen = { ...(proxyRequest.headers as Record<string, string>) };
          proxyRequest.headers = {
            ...(proxyRequest.headers as Record<string, string>),
            authorization: "Bearer service-token",
          };
        },
      });

      expect(await echo(base)).toEqual({
        cookie: null,
        authorization: "Bearer service-token",
        other: "kept",
      });
      expect(seen?.cookie).toBeUndefined();
      expect(seen?.authorization).toBeUndefined();
    });

    it("refuses a forward naming anything else", async ({ expect }) => {
      await expect(
        start({ forward: ["x-api-key" as "cookie"] }),
      ).rejects.toThrow('$proxy forward accepts "cookie" and "authorization"');
    });

    it("lets a $remote proxy still authenticate the caller, and its object form override forward", async ({
      expect,
    }) => {
      class Remote {
        whoami = $action({
          method: "GET",
          path: "/whoami",
          schema: {
            headers: z.object({ authorization: z.text().optional() }),
            response: z.object({ authorization: z.text().nullable() }),
          },
          handler: ({ headers }) => ({
            authorization: headers.authorization ?? null,
          }),
        });
      }
      const remote = Alepha.create({ env: { APP_NAME: "REMOTE" } })
        .with(Remote)
        .with(ServerLinksProvider);

      class WithRemote {
        upstream = $remote({
          url: () => remote.inject(ServerProvider).hostname,
          proxy: true,
        });
      }
      class WithRemoteNoAuth {
        upstream = $remote({
          url: () => remote.inject(ServerProvider).hostname,
          proxy: { forward: [] },
        });
      }

      await remote.start();
      const front = Alepha.create({ env: { APP_NAME: "FRONT" } })
        .with(WithRemote)
        .with(ServerLinksProvider);
      const bare = Alepha.create({ env: { APP_NAME: "BARE" } })
        .with(WithRemoteNoAuth)
        .with(ServerLinksProvider);
      await front.start();
      await bare.start();

      const whoami = async (app: Alepha) => {
        const response = await fetch(
          `${app.inject(ServerProvider).hostname}/api/upstream/whoami`,
          { headers: { authorization: "Bearer caller" } },
        );
        expect(response.status).toBe(200);
        return (await response.json()).authorization;
      };

      expect(await whoami(front)).toBe("Bearer caller");
      expect(await whoami(bare)).toBe(null);
    });
  });

  describe("timeout", () => {
    it("answers 503 at the deadline when the upstream never sends its headers", async ({
      expect,
    }) => {
      const { front, base, app } = await start({ timeout: [2, "seconds"] });
      const time = front.inject(DateTimeProvider);
      time.pause();
      const hit = new Promise<void>((resolve) => {
        app.hit = resolve;
      });

      const pending = fetch(`${base}/up/hang`);
      await hit;
      await time.travel(1_000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(settled).toBe(false);

      await time.travel(1_000);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        name: "TIMEOUT",
        data: { status: 503, timeout: 2_000 },
      });
    });

    it("never bounds a body that is still streaming past the deadline", async ({
      expect,
    }) => {
      const { front, base, app } = await start({ timeout: [2, "seconds"] });
      const time = front.inject(DateTimeProvider);
      time.pause();
      const hit = new Promise<void>((resolve) => {
        app.hit = resolve;
      });

      const response = await fetch(`${base}/up/slow`);
      expect(response.status).toBe(200);
      await hit;
      await time.travel(10_000);
      app.release?.();

      expect(await response.text()).toBe("first,second");
    });
  });
});

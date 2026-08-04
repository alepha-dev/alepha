import { $hook, $inject, Alepha, z } from "alepha";
import {
  $route,
  AlephaServer,
  ServerProvider,
  type ServerRequest,
  type ServerRoute,
} from "alepha/server";
import {
  type MultipartCap,
  MultipartCapProvider,
} from "alepha/server/multipart";
import { describe, it } from "vitest";
import { ServerMultipartProvider } from "../providers/ServerMultipartProvider.ts";

/**
 * Exposes the resolution so it can be asserted without moving bytes.
 *
 * The budget is decided before a single byte is read — that is the whole reason
 * it can be raised safely by a level that knows where the bytes are going — so
 * testing it through an upload would only make the assertion slower and the
 * failure harder to read.
 */
class Probe extends ServerMultipartProvider {
  public testResolve = (route: ServerRoute) =>
    this.resolveCaps({ headers: {} } as unknown as ServerRequest, route);
}

const BOUNDARY = "----AlephaBoundary";

const routeWith = (body: any): ServerRoute =>
  ({ schema: { body } }) as unknown as ServerRoute;

const setup = async (cap?: MultipartCap) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });

  if (cap) {
    const answer = cap;
    class FixedCap extends MultipartCapProvider {
      public override resolve(): MultipartCap {
        return answer;
      }
    }
    // Substituted before `AlephaServer` is registered: the module resolves the
    // provider on the way in, and a substitution after that point is refused —
    // loudly, which is the right call, but it means order is part of the API.
    alepha.with({ provide: MultipartCapProvider, use: FixedCap });
  }

  alepha.with(AlephaServer);

  const provider = alepha.inject(Probe);
  await alepha.start();
  return provider;
};

describe("multipart cap resolution", () => {
  it("falls back to the application-wide defaults", async ({ expect }) => {
    const provider = await setup();

    const caps = provider.testResolve(routeWith(z.object({ file: z.file() })));

    expect(caps.maxFileBytes).toBe(5_000_000);
    expect(caps.maxTotalBytes).toBe(10_000_000);
    expect(caps.maxParts).toBe(10);
  });

  it("lets a route raise the ceiling above the global default", async ({
    expect,
  }) => {
    const provider = await setup();

    // The inversion this whole design exists to remove: before, a declaration
    // could only ever lower the effective limit, so asking for more than the
    // global was a promise the framework silently broke.
    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxBytes: 50_000_000 }) })),
    );

    expect(caps.maxFileBytes).toBe(50_000_000);
  });

  it("lifts the message budget to fit the file it just allowed", async ({
    expect,
  }) => {
    const provider = await setup();

    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxBytes: 50_000_000 }) })),
    );

    // A 50 MB file inside a 10 MB message is a limit that reads as granted and
    // refuses anyway.
    expect(caps.maxTotalBytes).toBeGreaterThanOrEqual(50_000_000);
  });

  it("takes the largest declaration when a route has several file fields", async ({
    expect,
  }) => {
    const provider = await setup();

    // One ceiling applies to every part, so enforcing the smallest would refuse
    // the field that was explicitly allowed to be bigger.
    const caps = provider.testResolve(
      routeWith(
        z.object({
          avatar: z.file({ maxBytes: 2_000_000 }),
          archive: z.file({ maxBytes: 40_000_000 }),
        }),
      ),
    );

    expect(caps.maxFileBytes).toBe(40_000_000);
  });

  it("lets a resolver overrule the route's own declaration", async ({
    expect,
  }) => {
    const provider = await setup({ maxFileBytes: 1_000 });

    // The resolver is the only level that knows where the bytes actually land,
    // which is why it speaks last — even to lower a ceiling the route asked for.
    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxBytes: 50_000_000 }) })),
    );

    expect(caps.maxFileBytes).toBe(1_000);
  });

  it("keeps the levels a resolver said nothing about", async ({ expect }) => {
    const provider = await setup({ maxParts: 3 });

    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxBytes: 20_000_000 }) })),
    );

    expect(caps.maxParts).toBe(3);
    expect(caps.maxFileBytes).toBe(20_000_000);
  });

  it("has no opinion by default, so nothing is raised behind the app's back", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaServer);
    const caps = alepha.inject(MultipartCapProvider);
    await alepha.start();

    expect(
      caps.resolve({} as ServerRequest, routeWith(z.object({}))),
    ).toBeUndefined();
  });

  describe("enforcement", () => {
    it("accepts a file the route raised the ceiling for", async ({
      expect,
    }) => {
      const provider = await setup();
      const content = "x".repeat(20_000);
      const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`;

      // Bigger than the 5 MB default would allow? No — but bigger than the
      // route's own tightened ceiling below, which is what makes the pair of
      // assertions meaningful.
      const request = new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        body: new TextEncoder().encode(raw),
      });

      const body = await provider.parseMultipart(
        routeWith(z.object({ file: z.file({ maxBytes: 100_000 }) })),
        request,
      );

      expect((body.file as { size: number }).size).toBe(20_000);
    });

    it("refuses the same file when the route declares a smaller ceiling", async ({
      expect,
    }) => {
      const provider = await setup();
      const content = "x".repeat(20_000);
      const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`;

      const request = new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        body: new TextEncoder().encode(raw),
      });

      await expect(
        provider.parseMultipart(
          routeWith(z.object({ file: z.file({ maxBytes: 1_000 }) })),
          request,
        ),
      ).rejects.toThrow(/exceeds size limit/i);
    });

    it("names the field that overflowed", async ({ expect }) => {
      const provider = await setup();
      const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="avatar"; filename="a.bin"\r\n\r\n${"x".repeat(5_000)}\r\n--${BOUNDARY}--\r\n`;

      const request = new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        body: new TextEncoder().encode(raw),
      });

      // "a part exceeds 1000 bytes" is a worse thing to read than the name of
      // the input that did it — the parser cannot know, so the HTTP layer says.
      await expect(
        provider.parseMultipart(
          routeWith(z.object({ avatar: z.file({ maxBytes: 1_000 }) })),
          request,
        ),
      ).rejects.toThrow(/"avatar"/);
    });
  });
});

/**
 * `before:` on a hook has to actually order something.
 *
 * It used to accept a class and silently order nothing — `dep.constructor` on a
 * class is `Function`, which matches no service — so the constraint compiled,
 * ran, and guaranteed nothing. A constraint that quietly does nothing is worse
 * than one that refuses: the order it promises is then merely believed.
 *
 * Driven through a real request, because the property is about hook order and
 * calling `parseMultipart` directly would skip the very chain under test.
 *
 * ⚠️ What this does NOT license is moving authentication ahead of the body. On
 * the Node path the body is captured by the multipart hook itself
 * (`Readable.toWeb(node.req)`); any hook that awaits before that capture lets
 * the request stream drain into nothing. Ordering security first was tried and
 * emptied every upload — see the note on `ServerSecurityProvider`.
 */
describe("hook ordering constraints", () => {
  it("lets an earlier hook decide what the body hook sees", async ({
    expect,
  }) => {
    const seen: Array<unknown> = [];

    class EarlyProbe {
      public readonly onRequest = $hook({
        on: "server:onRequest",
        before: [ServerMultipartProvider],
        handler: ({ request }) => {
          (request as { marker?: unknown }).marker = "ran-first";
        },
      });
    }

    class Watcher {
      protected readonly caps = $inject(MultipartCapProvider);
      public readonly register = $hook({
        on: "configure",
        handler: () => {
          this.caps.use((request) => {
            seen.push((request as { marker?: unknown }).marker);
            return undefined;
          });
        },
      });
    }

    class UploadApi {
      upload = $route({
        method: "POST",
        path: "/upload",
        schema: { body: z.object({ file: z.file() }) },
        handler: () => ({ ok: true }) as never,
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    });
    alepha.with(AlephaServer);
    alepha.inject(EarlyProbe);
    alepha.inject(Watcher);
    alepha.inject(UploadApi);
    const server = alepha.inject(ServerProvider);
    await alepha.start();

    const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\nhello\r\n--${BOUNDARY}--\r\n`;
    const res = await fetch(`${server.hostname}/upload`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: new TextEncoder().encode(raw),
    });

    expect(res.status).toBe(200);
    // The resolver runs inside the body hook. Seeing the marker there is only
    // possible if the hook that set it ran first — which is the whole claim.
    expect(seen).toEqual(["ran-first"]);

    await alepha.stop();
  });
});

describe("MultipartCapProvider", () => {
  it("keeps asking when a resolver answers nothing in particular", async ({
    expect,
  }) => {
    // `{}` is an answer with no content, and it used to end the search because
    // an empty object is truthy. A resolver that recognises the route but has
    // no number to offer for it would silently veto every resolver behind it.
    const caps = new MultipartCapProvider();
    const request = {} as ServerRequest;
    const route = {} as ServerRoute;

    caps.use(() => ({ maxFileBytes: 42 }));
    caps.use(() => ({}));

    expect(caps.resolve(request, route)).toEqual({ maxFileBytes: 42 });
  });

  it("stops at the last resolver with something to say", async ({ expect }) => {
    const caps = new MultipartCapProvider();

    caps.use(() => ({ maxFileBytes: 42 }));
    caps.use(() => ({ maxFileBytes: 99 }));

    expect(caps.resolve({} as ServerRequest, {} as ServerRoute)).toEqual({
      maxFileBytes: 99,
    });
  });
});

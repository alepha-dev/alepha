import { Alepha, z } from "alepha";
import {
  AlephaServer,
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

    expect(caps.maxFileSize).toBe(5_000_000);
    expect(caps.maxTotalSize).toBe(10_000_000);
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
      routeWith(z.object({ file: z.file({ maxSize: 50_000_000 }) })),
    );

    expect(caps.maxFileSize).toBe(50_000_000);
  });

  it("lifts the message budget to fit the file it just allowed", async ({
    expect,
  }) => {
    const provider = await setup();

    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxSize: 50_000_000 }) })),
    );

    // A 50 MB file inside a 10 MB message is a limit that reads as granted and
    // refuses anyway.
    expect(caps.maxTotalSize).toBeGreaterThanOrEqual(50_000_000);
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
          avatar: z.file({ maxSize: 2_000_000 }),
          archive: z.file({ maxSize: 40_000_000 }),
        }),
      ),
    );

    expect(caps.maxFileSize).toBe(40_000_000);
  });

  it("lets a resolver overrule the route's own declaration", async ({
    expect,
  }) => {
    const provider = await setup({ maxFileSize: 1_000 });

    // The resolver is the only level that knows where the bytes actually land,
    // which is why it speaks last — even to lower a ceiling the route asked for.
    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxSize: 50_000_000 }) })),
    );

    expect(caps.maxFileSize).toBe(1_000);
  });

  it("keeps the levels a resolver said nothing about", async ({ expect }) => {
    const provider = await setup({ maxParts: 3 });

    const caps = provider.testResolve(
      routeWith(z.object({ file: z.file({ maxSize: 20_000_000 }) })),
    );

    expect(caps.maxParts).toBe(3);
    expect(caps.maxFileSize).toBe(20_000_000);
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
        routeWith(z.object({ file: z.file({ maxSize: 100_000 }) })),
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
          routeWith(z.object({ file: z.file({ maxSize: 1_000 }) })),
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
          routeWith(z.object({ avatar: z.file({ maxSize: 1_000 }) })),
          request,
        ),
      ).rejects.toThrow(/"avatar"/);
    });
  });
});

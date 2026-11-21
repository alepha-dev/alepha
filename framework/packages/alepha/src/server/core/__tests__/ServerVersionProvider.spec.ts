import { Alepha } from "alepha";
import {
  AlephaServer,
  BUILD_HEADER,
  buildToken,
  ServerProvider,
  versionOptions,
} from "alepha/server";
import { afterEach, describe, it } from "vitest";

/**
 * `GET /version` answers "what is running here?".
 *
 * Options are SEEDED at construction rather than written with `alepha.set`
 * afterwards, because `path` is read while the route's class field
 * initializes - before a post-creation write could land. Measured, not
 * assumed: seeding registers `GET /_version`, while the same value written
 * with `set` leaves the route on `/version`.
 *
 * A separate container per test for the same reason: the path is fixed at
 * registration, so one shared instance would carry the first test's path into
 * every later one.
 */
const server = async (
  options?: Partial<{ enabled: boolean; path: string; expose: string[] }>,
) => {
  const alepha = Alepha.create(
    options ? { "alepha.server.version.options": options } : {},
  ).with(AlephaServer);
  await alepha.start();
  return alepha.inject(ServerProvider);
};

describe("ServerVersionProvider", () => {
  it("should expose /version on a plain server, with no module opted in", async ({
    expect,
  }) => {
    const srv = await server();

    const res = await fetch(`${srv.hostname}/version`);

    expect(res.status).toBe(200);
    // The fallback record, since no build produced this test run.
    expect(await res.json()).toEqual({
      name: "unknown",
      version: "latest",
      framework: "unknown",
      build: { runtime: "node", dev: true },
    });
  });

  it("should leave /health alone, which is a different question", async ({
    expect,
  }) => {
    const srv = await server();

    const health = await fetch(`${srv.hostname}/health`);

    // /health is polled on a loop by supervisors and its schema is a contract
    // bay parses. Build identity does not belong in it.
    expect(Object.keys(await health.json()).sort()).toEqual([
      "date",
      "message",
      "ready",
      "uptime",
    ]);
  });

  describe("expose", () => {
    it("should publish the version while hiding the commit, for a closed-source app", async ({
      expect,
    }) => {
      const srv = await server({ expose: ["name", "version"] });

      const body = await (await fetch(`${srv.hostname}/version`)).json();

      expect(body).toEqual({ name: "unknown", version: "latest" });
    });

    it("should drop build's three members together when build is not exposed", async ({
      expect,
    }) => {
      const srv = await server({ expose: ["version", "framework"] });

      const body = await (await fetch(`${srv.hostname}/version`)).json();

      expect(body.build).toBeUndefined();
      expect(body.framework).toBe("unknown");
    });
  });

  describe("enabled", () => {
    it("should 404 when disabled, indistinguishable from no such route", async ({
      expect,
    }) => {
      const srv = await server({ enabled: false });

      const res = await fetch(`${srv.hostname}/version`);

      expect(res.status).toBe(404);
    });

    it("should not take /health down with it", async ({ expect }) => {
      const srv = await server({ enabled: false });

      const health = await fetch(`${srv.hostname}/health`);

      // The whole reason /version is a separate route: disabling version
      // disclosure must not disable readiness.
      expect(health.status).toBe(200);
    });
  });

  describe("runtime writes", () => {
    it("should honour an expose written after the container was created", async ({
      expect,
    }) => {
      // Unlike `path`, this is read per request, so a later write takes
      // effect without the container having to be rebuilt.
      const alepha = Alepha.create().with(AlephaServer);
      await alepha.start();
      alepha.set(versionOptions, { expose: ["version"] });

      const srv = alepha.inject(ServerProvider);
      const body = await (await fetch(`${srv.hostname}/version`)).json();

      expect(body).toEqual({ version: "latest" });
    });
  });

  describe("path", () => {
    it("should serve from a configured path instead", async ({ expect }) => {
      // Pins the field-initializer ordering: `$store(versionOptions)` has to be
      // declared before the `$route` that reads `path`, and the route's options
      // are built during configure, after an app's `alepha.set` at wiring time.
      const srv = await server({ path: "/_version" });

      expect((await fetch(`${srv.hostname}/_version`)).status).toBe(200);
      expect((await fetch(`${srv.hostname}/version`)).status).toBe(404);
    });
  });

  describe("build header", () => {
    const built = {
      name: "app",
      version: "1.0.0",
      commit: "6faea71",
      framework: "1.0.0",
      build: { runtime: "node", date: "2026-11-15T10:00:00.000Z" },
    };

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
    });

    it("should stamp the responses of a built app with its build", async ({
      expect,
    }) => {
      (globalThis as Record<string, unknown>).__ALEPHA_META__ =
        JSON.stringify(built);
      const srv = await server();

      const version = await fetch(`${srv.hostname}/version`);
      const health = await fetch(`${srv.hostname}/health`);

      const token = buildToken(built);
      expect(token).toMatch(/^[0-9a-f]{8}$/);
      expect(version.headers.get(BUILD_HEADER)).toBe(token);
      expect(health.headers.get(BUILD_HEADER)).toBe(token);
    });

    it("should hold the build even when /version withholds it", async ({
      expect,
    }) => {
      (globalThis as Record<string, unknown>).__ALEPHA_META__ =
        JSON.stringify(built);
      const srv = await server({ enabled: false });

      const res = await fetch(`${srv.hostname}/health`);

      expect(res.headers.get(BUILD_HEADER)).not.toContain("6faea71");
      expect(res.headers.get(BUILD_HEADER)).toBe(buildToken(built));
    });

    it("should send no header in development", async ({ expect }) => {
      const srv = await server();

      const res = await fetch(`${srv.hostname}/health`);

      expect(res.headers.get(BUILD_HEADER)).toBeNull();
    });

    it("should name another build after a rebuild", ({ expect }) => {
      const rebuilt = {
        ...built,
        build: { ...built.build, date: "2026-11-15T11:00:00.000Z" },
      };

      expect(buildToken(rebuilt)).not.toBe(buildToken(built));
      expect(buildToken({ build: { dev: true, date: built.build.date } })).toBe(
        undefined,
      );
    });
  });
});

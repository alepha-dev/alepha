import { Alepha } from "alepha";
import { AlephaServer, ServerRouterProvider } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaDevtools } from "../index.ts";

const devtoolsRoutes = (alepha: Alepha) =>
  alepha
    .inject(ServerRouterProvider)
    .getRoutes()
    .filter((r) => r.path.startsWith("/__devtools"));

describe("AlephaDevtools — production guard", () => {
  it("does NOT mount /__devtools routes in production", async () => {
    // Register the server explicitly so the router exists to inspect; the
    // devtools module itself must refuse to register its route-bearing
    // providers in production.
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        SERVER_PORT: 0,
        APP_SECRET: "test-secret",
      },
    })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    // The DB CRUD / atom-write / cleartext-env routes must not exist in prod.
    expect(devtoolsRoutes(alepha)).toHaveLength(0);

    await alepha.stop();
  });

  it("mounts /__devtools routes outside production", async () => {
    const alepha = Alepha.create({
      env: { SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    expect(devtoolsRoutes(alepha).length).toBeGreaterThan(0);

    await alepha.stop();
  });
});

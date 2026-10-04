import { mkdirSync } from "node:fs";

import { Alepha } from "alepha";
import {
  AlephaServer,
  ServerProvider,
  ServerRouterProvider,
} from "alepha/server";
import { beforeAll, describe, expect, it } from "vitest";

import { AlephaDevtools } from "../index.ts";

// Outside production the module serves its built UI from `assets/ui`, which is a
// gitignored build artifact (absent in CI). ServerStaticProvider would fail to
// boot on the missing directory. This spec only exercises route registration,
// so make the static root exist as an empty directory.
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

const devtoolsRoutes = (alepha: Alepha) =>
  alepha
    .inject(ServerRouterProvider)
    .getRoutes()
    .filter((r) => r.path.startsWith("/__devtools"));

describe("AlephaDevtools: production guard", () => {
  it("does NOT mount /__devtools routes in production, even with ALEPHA_INSPECT=1", async () => {
    // `ALEPHA_INSPECT=1` opts the inspector into production, for its socket.
    // It must never put these routes on the app's own public port.
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        SERVER_PORT: 0,
        APP_SECRET: "test-secret",
        ALEPHA_INSPECT: "1",
      },
    })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    expect(devtoolsRoutes(alepha)).toHaveLength(0);

    await alepha.stop();
  });

  it("mounts the inspector's routes under /__devtools/api outside production", async () => {
    const alepha = Alepha.create({
      env: { SERVER_PORT: 0, ALEPHA_INSPECT: "1" },
    })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    const paths = devtoolsRoutes(alepha).map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("GET /__devtools/api/metadata");
    expect(paths).toContain("DELETE /__devtools/api/db/:entity/records/:id");

    // And they answer, validated and serialized by the server.
    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/__devtools/api/logs?limit=1`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hasMore: expect.any(Boolean) });

    await alepha.stop();
  });

  it("mounts nothing under test unless the inspector is asked for", async () => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    expect(devtoolsRoutes(alepha)).toHaveLength(0);

    await alepha.stop();
  });
});

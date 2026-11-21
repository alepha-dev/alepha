import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { OpenApiDocument } from "alepha/server/swagger";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SwaggerExplorer } from "../SwaggerExplorer.tsx";

const document: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "Shop", version: "1.0.0" },
  paths: {
    "/api/ping": {
      get: { operationId: "ping", responses: { "200": { description: "OK" } } },
    },
  },
};

describe("SwaggerExplorer", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "#");
    await alepha?.stop();
    alepha = undefined;
  });

  it("opens on a hash that is not valid percent-encoding", async () => {
    vi.stubGlobal("fetch", async () => Response.json(document));
    window.history.replaceState(null, "", "#%");
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <SwaggerExplorer specUrl="/docs/json" />
      </AlephaContext.Provider>,
    );
    // The hash names no operation: the first one is shown.
    expect(await screen.findByText("Shop")).toBeTruthy();
    expect((await screen.findAllByText("/api/ping")).length).toBeGreaterThan(0);
  });
});

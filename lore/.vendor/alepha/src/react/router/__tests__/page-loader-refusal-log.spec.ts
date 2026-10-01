import { Alepha } from "alepha";
import { describe, expect, it, vi } from "vitest";

import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";
import {
  ReactPageProvider,
  type ReactRouterState,
} from "../providers/ReactPageProvider.ts";

// `onError` returning null means "render the default error view": returning
// undefined rethrows, which is a router concern this spec is not about.
const stateFor = (path: string): ReactRouterState =>
  ({
    layers: [],
    url: new URL(`http://localhost${path}`),
    onError: () => null,
  }) as unknown as ReactRouterState;

class Refusal extends Error {
  public readonly status = 403;
}

class Broken extends Error {}

class Router {
  refused = $page({
    path: "/refused",
    name: "refused",
    loader: () => {
      throw new Refusal("Accès refusé");
    },
    lazy: async () => ({ default: () => null }),
  });

  broken = $page({
    path: "/broken",
    name: "broken",
    loader: () => {
      throw new Broken("boom");
    },
    lazy: async () => ({ default: () => null }),
  });
}

/**
 * A loader that refuses is the app working. An admin deep link a visitor may
 * not open throws a 403 and renders its refusal view; logging that at error
 * level fills the log with expected outcomes and buries the 5xx underneath.
 */
describe("$page loader logs a refusal below error level", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter).with(Router);
    await alepha.start();
    const pages = alepha.inject(ReactPageProvider);
    const log = (pages as unknown as { log: Record<string, () => void> }).log;
    return {
      pages,
      error: vi.spyOn(log, "error").mockImplementation(() => undefined),
      debug: vi.spyOn(log, "debug").mockImplementation(() => undefined),
    };
  };

  it("logs a 4xx loader throw at debug", async () => {
    const { pages, error, debug } = await boot();

    const state = stateFor("/refused");
    await pages.createLayers(pages.page("refused"), state);

    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      "Page loader has failed",
      expect.any(Refusal),
    );
    // The page still renders its refusal: the error reaches the layer.
    expect(state.layers.at(-1)?.error).toBeInstanceOf(Refusal);
  });

  it("still logs an error with no status at error level", async () => {
    const { pages, error, debug } = await boot();

    await pages.createLayers(pages.page("broken"), stateFor("/broken"));

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Page loader has failed",
      expect.any(Broken),
    );
  });
});

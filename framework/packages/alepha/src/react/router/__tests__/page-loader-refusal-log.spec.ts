import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, it } from "vitest";

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
    // At debug, so the line under test is kept, and into memory, where the
    // assertions read it: a LOG_LEVEL alone would send it to the console.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "debug" } })
      .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
      .with(AlephaReactRouter)
      .with(Router);
    const destination = alepha.inject(MemoryDestinationProvider);
    await alepha.start();
    const pages = alepha.inject(ReactPageProvider);
    // The loader failure as logged, at whichever level it was.
    const failures = (level: "ERROR" | "DEBUG") =>
      destination.logs.filter(
        (entry) =>
          entry.level === level && entry.message === "Page loader has failed",
      );
    return { pages, failures };
  };

  it("logs a 4xx loader throw at debug", async () => {
    const { pages, failures } = await boot();

    const state = stateFor("/refused");
    await pages.createLayers(pages.page("refused"), state);

    expect(failures("ERROR")).toEqual([]);
    expect(failures("DEBUG")).toHaveLength(1);
    expect(failures("DEBUG")[0].data).toBeInstanceOf(Refusal);
    // The page still renders its refusal: the error reaches the layer.
    expect(state.layers.at(-1)?.error).toBeInstanceOf(Refusal);
  });

  it("still logs an error with no status at error level", async () => {
    const { pages, failures } = await boot();

    await pages.createLayers(pages.page("broken"), stateFor("/broken"));

    expect(failures("DEBUG")).toEqual([]);
    expect(failures("ERROR")).toHaveLength(1);
    expect(failures("ERROR")[0].data).toBeInstanceOf(Broken);
  });
});

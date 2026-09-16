import { Alepha } from "alepha";
import { ReactPageProvider } from "alepha/react/router";
import { describe, it } from "vitest";

import { AppRouter } from "../ui/AppRouter.tsx";

/**
 * The Rows routes keep their editor mounted while a row opens (#Q2351).
 *
 * Since #Q2349 each router layer is keyed by its path compiled from its
 * params, and a changed key is a remount of that layer and everything below.
 * `/rows`, `/rows/:table` and `/rows/:table/:id` were three sibling pages
 * sharing one editor, so every step changed the only key there was: opening a
 * row reloaded the grid, cleared the selection and reset the rail.
 *
 * Nested, the grid is the `/rows/:table` layer and the rail is the `/rows`
 * layer. What pins the instances is that those layers keep their key, and are
 * reused, across the steps that must not remount them.
 */
describe("the devtools Rows routes", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { PUBLIC_URL: "http://localhost" },
    });
    alepha.inject(AppRouter);
    await alepha.start();
    const pages = alepha.inject(ReactPageProvider);

    const layersOf = async (
      name: "rowsTable" | "rowsRecord",
      params: Record<string, string>,
      previous: Array<{ key?: string }> = [],
    ) => {
      const pathname = pages.pathname(name, { params });
      const result = await pages.createLayers(
        pages.page(name),
        {
          url: new URL(`http://localhost${pathname}`),
          params,
          query: {},
          layers: [],
          onError: () => null,
          meta: {},
        } as any,
        previous as any,
      );
      return result.state!.layers;
    };

    return { layersOf };
  };

  it("nests the record inside the table, and the table inside the rail", async ({
    expect,
  }) => {
    const { layersOf } = await setup();

    const layers = await layersOf("rowsRecord", { table: "users", id: "42" });

    expect(layers.map((layer) => layer.key)).toEqual([
      "/",
      "/rows",
      "/rows/users",
      "/rows/users/42",
    ]);
  });

  it("reuses the rail and the grid when a row of the open table opens", async ({
    expect,
  }) => {
    const { layersOf } = await setup();

    const table = await layersOf("rowsTable", { table: "users" });
    const record = await layersOf(
      "rowsRecord",
      { table: "users", id: "42" },
      table,
    );

    // The layout, the rail and the grid carry the same key, and are reused;
    // only the record below them is new.
    expect(record.slice(0, 3).map((layer) => layer.key)).toEqual(
      table.map((layer) => layer.key),
    );
    expect(record.map((layer) => layer.cache === true)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("keeps the rail and remounts the grid when another table opens", async ({
    expect,
  }) => {
    const { layersOf } = await setup();

    const users = await layersOf("rowsTable", { table: "users" });
    const posts = await layersOf("rowsTable", { table: "posts" }, users);

    expect(posts.map((layer) => layer.key)).toEqual([
      "/",
      "/rows",
      "/rows/posts",
    ]);
    expect(posts.map((layer) => layer.cache === true)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

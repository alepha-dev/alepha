import { Alepha, z } from "alepha";
import { beforeAll, describe, expect, it } from "vitest";

import {
  filtersToQuery,
  queryToFilters,
  shareFiltersUrl,
} from "../query-filters.ts";

const schema = z.object({
  search: z.text().optional(),
  status: z.array(z.enum(["new", "triaged", "done"])).optional(),
  limit: z.number().optional(),
  archived: z.boolean().optional(),
});

describe("queryToFilters", () => {
  let alepha: Alepha;

  beforeAll(async () => {
    alepha = Alepha.create();
    await alepha.start();
  });

  it("reads a scalar param declared by the schema", () => {
    const values = queryToFilters(alepha, schema, { search: "auth" });

    expect(values).toEqual({ search: "auth" });
  });

  it("splits a comma-joined param into an array field", () => {
    // The router collapses repeated keys to one value, so `?status=a&status=b`
    // never survives the trip. Comma is the only multi-value spelling a shared
    // link can carry.
    const values = queryToFilters(alepha, schema, { status: "new,triaged" });

    expect(values).toEqual({ status: ["new", "triaged"] });
  });

  it("wraps a single value reaching an array field", () => {
    const values = queryToFilters(alepha, schema, { status: "new" });

    expect(values).toEqual({ status: ["new"] });
  });

  it("coerces a param to the type the schema declares", () => {
    const values = queryToFilters(alepha, schema, {
      limit: "25",
      archived: "true",
    });

    expect(values).toEqual({ limit: 25, archived: true });
  });

  it("drops params the filter schema does not declare", () => {
    // The page owns query params the table knows nothing about (`?tab=`,
    // a locale, a tracking param). Passing one through would put it in the
    // fetch payload.
    const values = queryToFilters(alepha, schema, {
      search: "auth",
      tab: "open",
    });

    expect(values).toEqual({ search: "auth" });
  });

  it("returns undefined when no param matches", () => {
    // `undefined` and not `{}`: the caller hands this straight to the seed
    // slot, where an empty object is a seed that outranks the reader's
    // stored filters with nothing in it.
    expect(queryToFilters(alepha, schema, { tab: "open" })).toBeUndefined();
    expect(queryToFilters(alepha, schema, {})).toBeUndefined();
  });

  it("ignores an empty param rather than filtering on emptiness", () => {
    expect(queryToFilters(alepha, schema, { search: "" })).toBeUndefined();
  });

  it("honours an allowlist of keys", () => {
    const values = queryToFilters(
      alepha,
      schema,
      {
        search: "auth",
        status: "new",
      },
      ["status"],
    );

    expect(values).toEqual({ status: ["new"] });
  });

  it("drops a value the schema refuses rather than throwing", () => {
    // A stale bookmark must degrade to the unfiltered list, never to an
    // error page.
    const values = queryToFilters(alepha, schema, {
      status: "nonsense",
      search: "auth",
    });

    expect(values).toEqual({ search: "auth" });
  });
});

describe("filtersToQuery", () => {
  it("serializes scalars as strings", () => {
    expect(filtersToQuery({ search: "auth", limit: 25 })).toEqual({
      search: "auth",
      limit: "25",
    });
  });

  it("joins an array with commas", () => {
    expect(filtersToQuery({ status: ["new", "triaged"] })).toEqual({
      status: "new,triaged",
    });
  });

  it("skips empty values", () => {
    expect(
      filtersToQuery({
        search: "",
        status: [],
        archived: undefined,
        page: null,
      }),
    ).toEqual({});
  });

  it("skips a value it cannot put in a URL", () => {
    // Objects and dates have no agreed spelling here. Dropping is honest:
    // a link that carries half the filters is better than one that carries
    // `[object Object]`.
    expect(filtersToQuery({ range: { from: 1 }, search: "auth" })).toEqual({
      search: "auth",
    });
  });

  it("round-trips what queryToFilters reads", async () => {
    const alepha = Alepha.create();
    await alepha.start();
    const values = { search: "auth", status: ["new", "triaged"], limit: 25 };

    expect(queryToFilters(alepha, schema, filtersToQuery(values))).toEqual(
      values,
    );
  });
});

describe("shareFiltersUrl", () => {
  const keys = ["search", "status", "limit", "archived"];

  it("puts the active filters on the page's own URL", () => {
    const url = shareFiltersUrl("https://lore.alepha.dev/odzala/quests", keys, {
      status: ["new"],
      search: "auth",
    });

    expect(url).toBe(
      "https://lore.alepha.dev/odzala/quests?status=new&search=auth",
    );
  });

  it("leaves a comma readable rather than percent-encoded", () => {
    // The point of the feature is a link someone reads before clicking.
    // `?status=new%2Ctriaged` is what `URLSearchParams` writes on its own.
    const url = shareFiltersUrl("https://lore.alepha.dev/odzala/quests", keys, {
      status: ["new", "triaged"],
    });

    expect(url).toBe(
      "https://lore.alepha.dev/odzala/quests?status=new,triaged",
    );
  });

  it("keeps query params the page owns", () => {
    // A table's filters are not the whole query: the page may carry a tab, a
    // locale, a campaign tag. A share link that drops them lands somewhere
    // else.
    const url = shareFiltersUrl(
      "https://lore.alepha.dev/odzala/quests?tab=open",
      keys,
      { status: ["new"] },
    );

    expect(url).toBe(
      "https://lore.alepha.dev/odzala/quests?tab=open&status=new",
    );
  });

  it("drops a stale filter param the reader has since cleared", () => {
    const url = shareFiltersUrl(
      "https://lore.alepha.dev/odzala/quests?status=done&tab=open",
      keys,
      { search: "auth" },
    );

    expect(url).toBe(
      "https://lore.alepha.dev/odzala/quests?tab=open&search=auth",
    );
  });

  it("returns the bare page URL when nothing is filtered", () => {
    const url = shareFiltersUrl(
      "https://lore.alepha.dev/odzala/quests?status=done",
      keys,
      {},
    );

    expect(url).toBe("https://lore.alepha.dev/odzala/quests");
  });
});

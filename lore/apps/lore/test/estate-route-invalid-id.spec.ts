import { Alepha, AlephaError } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { isHttpError } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * `/account/estates/:estateId` with an id that is not a UUID answers 404
 * from the loader, before any request is encoded (#Q2939). It used to fail
 * `getEstate`'s param schema and surface as a SCHEMA_VALIDATION blight.
 */
describe("the estate page with a malformed id", () => {
  const containers: Alepha[] = [];

  afterEach(async () => {
    await Promise.all(containers.splice(0).map((it) => it.stop()));
  });

  it("should answer 404 from the loader", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    bootLore(alepha, ["routes"]);
    await alepha.start();
    containers.push(alepha);

    const page = [...alepha.primitives($page)].find((it) => it.name === "bay");
    if (!page?.options.loader) throw new AlephaError("no bay page loader");

    const loader = page.options.loader;
    const error = await Promise.resolve()
      .then(() => loader({ params: { estateId: "not-a-uuid" } } as never))
      .catch((e: unknown) => e);

    expect(isHttpError(error, 404)).toBe(true);
  });
});

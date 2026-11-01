import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, it, vi } from "vitest";

import LatestBanner from "../../src/components/layout/LatestBanner.tsx";

const show = async () => {
  const alepha = Alepha.create().with(AlephaReactRouter);
  await alepha.start();
  alepha.store.set("alepha.react.router.state", {
    url: new URL("https://latest.alepha.dev/docs/guides-core"),
    layers: [],
    onError: () => {},
    name: "docs",
  } as never);

  render(
    <AlephaContext.Provider value={alepha}>
      <LatestBanner />
    </AlephaContext.Provider>,
  );
};

describe("LatestBanner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links latest.alepha.dev to the same page on the release", async ({
    expect,
  }) => {
    vi.stubEnv("VITE_DOCS_SITE", "latest");

    await show();

    expect(
      screen.getByRole("link", { name: "Read the release docs" }),
    ).toHaveProperty("href", "https://alepha.dev/docs/guides-core");
  });

  it("shows nothing on the release", async ({ expect }) => {
    await show();

    expect(screen.queryByRole("note")).toBeNull();
  });
});

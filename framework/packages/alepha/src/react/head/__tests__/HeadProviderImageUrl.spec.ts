import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * A crawler unfurling a link ignores a relative `og:image`, so a head naming
 * `/logo.png` showed a placeholder in every chat preview. The image is
 * resolved against the same origin as the canonical.
 */
describe("HeadProvider image URL", () => {
  const createProvider = (env: Record<string, unknown> = {}) => {
    const alepha = Alepha.create({
      env: { PUBLIC_URL: "https://alepha.dev", ...env },
    });
    return alepha.inject(HeadProvider);
  };

  const fill = (provider: HeadProvider, head: any) => {
    provider.global = [head];
    const state: any = {
      head: {},
      layers: [
        { path: "", route: {} },
        { path: "/docs", route: {} },
      ],
    };
    provider.fillHead(state);
    return state;
  };

  const contentOf = (state: any, key: string) =>
    state.head.meta.find((m: any) => (m.property ?? m.name) === key)?.content;

  it("makes a relative image absolute in og:image and twitter:image", () => {
    const state = fill(createProvider(), {
      title: "Docs",
      image: "/logo.png",
    });

    expect(contentOf(state, "og:image")).toBe("https://alepha.dev/logo.png");
    expect(contentOf(state, "twitter:image")).toBe(
      "https://alepha.dev/logo.png",
    );
  });

  it("resolves the og and twitter overrides too", () => {
    const state = fill(createProvider({ PUBLIC_URL: "https://alepha.dev/" }), {
      title: "Docs",
      og: { image: "/og.png" },
      twitter: { image: "/tw.png" },
    });

    expect(contentOf(state, "og:image")).toBe("https://alepha.dev/og.png");
    expect(contentOf(state, "twitter:image")).toBe("https://alepha.dev/tw.png");
  });

  it("keeps an absolute image as it is", () => {
    const state = fill(createProvider(), {
      title: "Docs",
      image: "https://cdn.example.app/og.png",
    });

    expect(contentOf(state, "og:image")).toBe("https://cdn.example.app/og.png");
  });

  it("leaves a relative image alone with no origin to build on", () => {
    const state = fill(createProvider({ PUBLIC_URL: "" }), {
      title: "Docs",
      image: "/logo.png",
    });

    expect(contentOf(state, "og:image")).toBe("/logo.png");
  });

  it("does not touch other meta tags", () => {
    const state = fill(createProvider(), {
      title: "Docs",
      description: "/not-a-url",
    });

    expect(contentOf(state, "og:description")).toBe("/not-a-url");
  });
});

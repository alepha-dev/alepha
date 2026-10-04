import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AlephaCapacitor,
  CapacitorConfigProvider,
  DeepLinkProvider,
  MemoryCapacitorConfigProvider,
  MemoryDeepLinkProvider,
} from "../index.ts";

const setup = (scheme = "mobile") => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: DeepLinkProvider, use: MemoryDeepLinkProvider })
    .with(AlephaCapacitor);
  alepha.inject(MemoryCapacitorConfigProvider).config = {
    appId: "dev.alepha.mobile",
    variant: "base",
    scheme,
    mode: "bundled",
    apiUrl: "https://api.test",
    env: {},
  };
  return { alepha, links: alepha.inject(MemoryDeepLinkProvider) };
};

describe("DeepLinkProvider.parse", () => {
  it("reads <scheme>://app/<path> with its query and hash", ({ expect }) => {
    const { links } = setup();

    expect(links.parse("mobile://app/notes/42?from=mail#top")).toEqual({
      kind: "route",
      path: "/notes/42?from=mail#top",
    });
    expect(links.parse("mobile://app")).toEqual({ kind: "route", path: "/" });
  });

  it("ignores another scheme, another host and user info", ({ expect }) => {
    const { links } = setup();

    expect(links.parse("other://app/notes")).toBeUndefined();
    expect(links.parse("https://app/notes")).toBeUndefined();
    expect(links.parse("mobile://evil/notes")).toBeUndefined();
    expect(links.parse("mobile://user:secret@app/notes")).toBeUndefined();
  });

  it("refuses traversal and a malformed encoding rather than resolving them", ({
    expect,
  }) => {
    const { links } = setup();

    expect(links.parse("mobile://app/notes/../admin")).toBeUndefined();
    expect(links.parse("mobile://app/notes/%2e%2e/admin")).toBeUndefined();
    expect(links.parse("mobile://app/notes/%E0%A4%A")).toBeUndefined();
    expect(links.parse("not a url")).toBeUndefined();
  });

  it("answers only the selected variant's scheme", ({ expect }) => {
    const { links } = setup("mobile-pro");

    expect(links.parse("mobile://app/notes")).toBeUndefined();
    expect(links.parse("mobile-pro://app/notes")).toEqual({
      kind: "route",
      path: "/notes",
    });
  });

  it("reserves auth/callback", ({ expect }) => {
    const { links } = setup();

    expect(links.parse("mobile://auth/callback?code=x")?.kind).toBe("auth");
  });
});

describe("DeepLinkProvider", () => {
  it("stages the launch link as the first path", async ({ expect }) => {
    const { links } = setup();
    links.launch = "mobile://app/notes/42";

    expect(await links.resolveLaunch()).toBe("/notes/42");
  });

  it("refuses a sign-in callback with no handler, without routing it", async ({
    expect,
  }) => {
    const { links } = setup();
    links.launch = "mobile://auth/callback?code=secret";

    expect(await links.resolveLaunch()).toBeUndefined();
    await expect(
      links.open("mobile://auth/callback?code=other"),
    ).rejects.toThrow(/no browser sign-in/);
  });

  it("hands a sign-in callback to the handler when one is installed", async ({
    expect,
  }) => {
    const { links } = setup();
    const received: string[] = [];
    links.authCallback = async (url) => {
      received.push(url.searchParams.get("code") ?? "");
    };

    await links.open("mobile://auth/callback?code=abc");

    expect(received).toEqual(["abc"]);
  });

  it("listens from start to stop", async ({ expect }) => {
    const { alepha, links } = setup();

    await alepha.start();
    expect(links.listening).toBe(true);
    await alepha.stop();
    expect(links.listening).toBe(false);
  });
});

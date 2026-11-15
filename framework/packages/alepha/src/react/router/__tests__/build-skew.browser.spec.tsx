import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { BUILD_HEADER, buildToken } from "alepha/server";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { $page, ReactBrowserProvider, ReactRouter } from "../index.browser.ts";

describe("A newer build deployed while the tab is open", () => {
  const built = {
    name: "app",
    version: "1.0.0",
    commit: "6faea71",
    framework: "1.0.0",
    build: { runtime: "browser", date: "2026-11-15T10:00:00.000Z" },
  };
  const next = buildToken({
    ...built,
    build: { ...built.build, date: "2026-11-15T11:00:00.000Z" },
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
  });

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const start = async (options: { built?: boolean } = {}) => {
    if (options.built !== false) {
      (globalThis as Record<string, unknown>).__ALEPHA_META__ =
        JSON.stringify(built);
    }

    // jsdom cannot leave the document: the navigations are recorded instead.
    const left: string[] = [];
    const real = window.location;
    const location = {
      href: real.href,
      origin: real.origin,
      pathname: real.pathname,
      search: real.search,
      hash: real.hash,
      assign: (url: string) => left.push(`assign ${url}`),
      replace: (url: string) => left.push(`replace ${url}`),
      reload: () => left.push("reload"),
    } as unknown as Location;
    class RecordingBrowserProvider extends ReactBrowserProvider {
      public override get location() {
        return location;
      }
    }

    class App {
      home = $page({ path: "/", component: () => <main>home page</main> });
      other = $page({
        path: "/other",
        component: () => <main>other page</main>,
      });
    }

    const alepha = Alepha.create()
      .with({ provide: ReactBrowserProvider, use: RecordingBrowserProvider })
      .with(AlephaReact)
      .with(App);
    await act(async () => {
      await alepha.start();
    });
    const browser = alepha.inject(ReactBrowserProvider);

    const respond = (url: string, build: string | undefined) =>
      act(async () => {
        await alepha.events.emit("client:fetch:after", {
          url,
          request: {},
          response: new Response(null, {
            headers: build ? { [BUILD_HEADER]: build } : {},
          }),
        });
      });

    const push = (url: `/${string}`) =>
      act(async () => {
        void alepha.inject(ReactRouter).push(url);
        await wait(50);
      });

    // A tab coming back into view after `checked` ms, the server running `served`.
    const returnToTab = (served: string | undefined, checked = 61_000) =>
      act(async () => {
        const asked: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
          asked.push(url);
          return new Response(null, {
            headers: served ? { [BUILD_HEADER]: served } : {},
          });
        });
        (browser as unknown as { lastBuildCheck: number }).lastBuildCheck =
          Date.now() - checked;
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await wait(20);
        vi.unstubAllGlobals();
        return asked;
      });

    return { left, respond, push, returnToTab };
  };

  it("loads the next page as a full page once a response came from another build", async () => {
    const { left, respond, push } = await start();

    await respond("/api/quests", next);
    await push("/other");

    expect(left).toEqual(["assign /other"]);
    expect(document.body.textContent).toContain("home page");
  });

  it("navigates in place while the responses come from its own build", async () => {
    const { left, respond, push } = await start();

    await respond("/api/quests", buildToken(built));
    await respond("/api/quests", undefined);
    await push("/other");

    expect(left).toEqual([]);
    expect(document.body.textContent).toContain("other page");
  });

  it("ignores the build of another origin's Alepha app", async () => {
    const { left, respond, push } = await start();

    await respond("https://api.example.app/quests", next);
    await push("/other");

    expect(left).toEqual([]);
    expect(document.body.textContent).toContain("other page");
  });

  it("compares nothing in development", async () => {
    const { left, respond, push } = await start({ built: false });

    await respond("/api/quests", next);
    await push("/other");

    expect(left).toEqual([]);
    expect(document.body.textContent).toContain("other page");
  });

  it("asks the server for its build when the tab comes back into view", async () => {
    const { left, push, returnToTab } = await start();

    expect(await returnToTab(next)).toEqual(["/health"]);
    await push("/other");

    expect(left).toEqual(["assign /other"]);
  });

  it("asks at most once a minute", async () => {
    const { left, push, returnToTab } = await start();

    expect(await returnToTab(next, 30_000)).toEqual([]);
    await push("/other");

    expect(left).toEqual([]);
  });
});

import { $atom, $hook, Alepha, type State, z } from "alepha";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReactBrowserProvider,
  type ReactHydrationState,
  type RouterPushOptions,
  reactBrowserOptions,
} from "../providers/ReactBrowserProvider.ts";

/**
 * Records what `invalidate` asks `render` to carry over, without rendering.
 */
class InvalidateReactBrowserProvider extends ReactBrowserProvider {
  public readonly renderCalls: Array<Record<string, any>> = [];
  public testInvalidate = this.invalidate.bind(this);

  protected override async render(
    options: Record<string, any> = {},
  ): Promise<void> {
    this.renderCalls.push(options);
  }
}

class TestReactBrowserProvider extends ReactBrowserProvider {
  public testGetHydrationState = this.getHydrationState.bind(this);
  public testAttachAnchorInterceptor = this.attachAnchorInterceptor.bind(this);
  public testApplyHydration = this.applyHydration.bind(this);
  public pushCalls: Array<{ url: string; options?: RouterPushOptions }> = [];

  public override async push(
    url: string,
    options?: RouterPushOptions,
  ): Promise<void> {
    this.pushCalls.push({ url, options });
  }
}

describe("ReactBrowserProvider", () => {
  let alepha: Alepha;
  let provider: TestReactBrowserProvider;

  beforeEach(() => {
    alepha = Alepha.create();
    provider = alepha.inject(TestReactBrowserProvider);

    // Clean up any leftover script tags
    document.getElementById("__ssr")?.remove();
  });

  describe("getHydrationState", () => {
    it("should parse hydration data from script tag", () => {
      const data = {
        "alepha.react.router.layers": [
          { name: "home", props: { title: "Hello" } },
        ],
      };

      const script = document.createElement("script");
      script.id = "__ssr";
      script.type = "application/json";
      script.textContent = JSON.stringify(data);
      document.body.appendChild(script);

      const result = provider.testGetHydrationState();

      expect(result).toEqual(data);
      expect(result?.["alepha.react.router.layers"]).toHaveLength(1);
      expect(result?.["alepha.react.router.layers"]?.[0].name).toBe("home");
    });

    it("should return undefined when script tag is missing", () => {
      const result = provider.testGetHydrationState();

      expect(result).toBeUndefined();
    });

    it("should return undefined when script tag is empty", () => {
      const script = document.createElement("script");
      script.id = "__ssr";
      script.type = "application/json";
      script.textContent = "";
      document.body.appendChild(script);

      const result = provider.testGetHydrationState();

      expect(result).toBeUndefined();
    });

    it("should return undefined and log error on malformed JSON", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const script = document.createElement("script");
      script.id = "__ssr";
      script.type = "application/json";
      script.textContent = "{invalid json";
      document.body.appendChild(script);

      const result = provider.testGetHydrationState();

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledOnce();

      consoleSpy.mockRestore();
    });

    it("should handle hydration data with multiple layers and atoms", () => {
      const data = {
        "alepha.react.router.layers": [
          { name: "layout", part: "/", config: { params: {} } },
          {
            name: "dashboard",
            part: "/dashboard",
            props: { count: 42 },
            config: { params: {}, query: { tab: "overview" } },
          },
        ],
        "alepha.i18n.locale": "en",
      };

      const script = document.createElement("script");
      script.id = "__ssr";
      script.type = "application/json";
      script.textContent = JSON.stringify(data);
      document.body.appendChild(script);

      const result = provider.testGetHydrationState();

      expect(result?.["alepha.react.router.layers"]).toHaveLength(2);
      expect(result?.["alepha.i18n.locale"]).toBe("en");
    });
  });

  describe("applyHydration", () => {
    const testAtom = $atom({
      name: "test.hydration.settings",
      schema: z.object({ theme: z.string() }),
      default: { theme: "light" },
    });

    it("writes a valid hydrated value through, parsed against the schema", () => {
      alepha.store.get(testAtom); // pre-register, as a real app would

      provider.testApplyHydration({
        [testAtom.key]: { theme: "dark", junk: true },
      } as unknown as ReactHydrationState);

      expect(alepha.store.get(testAtom)).toEqual({ theme: "dark" });
    });

    it("keeps the default and warns when a hydrated value fails schema validation", async () => {
      alepha.store.get(testAtom); // pre-register, as a real app would

      const onLog = vi.fn();
      alepha.events.on("log", onLog);

      provider.testApplyHydration({
        [testAtom.key]: { theme: 42 },
      } as unknown as ReactHydrationState);

      // Logger delivery is event-based and async — flush before asserting.
      await new Promise((r) => setTimeout(r, 0));

      expect(alepha.store.get(testAtom)).toEqual({ theme: "light" });
      expect(
        onLog.mock.calls.some(([payload]) =>
          payload.entry?.message?.includes(testAtom.key),
        ),
      ).toBe(true);
    });

    it("passes through a not-yet-registered atom value, decoded later at registration", () => {
      provider.testApplyHydration({
        [testAtom.key]: { theme: "dark", junk: true },
      } as unknown as ReactHydrationState);

      // First access registers the atom and decodes the raw hydrated value
      // (StateManager.register()'s decode-at-registration path).
      expect(alepha.store.get(testAtom)).toEqual({ theme: "dark" });
    });

    it("skips alepha.react.router.layers — it is not treated as an atom value", () => {
      provider.testApplyHydration({
        "alepha.react.router.layers": [{ name: "home" }],
      } as ReactHydrationState);

      expect(
        alepha.store.getAtom("alepha.react.router.layers"),
      ).toBeUndefined();
    });
  });

  /**
   * Hydration is inbound state: the server already decided it, so every `start`
   * hook must boot with it in place.
   *
   * Applying it in `ready` (where the render happens) meant `start` hooks read
   * defaults and configured themselves against a value that was about to
   * change. i18n is the case that exposed it: `I18nProvider` preloads the
   * dictionaries for the active language on `start`, so with the payload
   * unapplied it preloaded the fallback language's dictionary instead. The real
   * language landed in `ready`, but `StateManager.set` emits `state:mutate`
   * fire-and-forget, so that dictionary's loader was still in flight when
   * `render()` hydrated React one line later — and `translate()` falls through
   * to the fallback dictionary when the active one has no entry for a key.
   * The whole page rendered in the fallback language while `lang` already said
   * otherwise, and it never repaired itself, because finishing a dictionary
   * load notifies nobody.
   */
  describe("hydration ordering", () => {
    const key = "test.hydration.ordering" as keyof State;

    it("applies the SSR payload before any start hook runs", async () => {
      const script = document.createElement("script");
      script.id = "__ssr";
      script.type = "application/json";
      script.textContent = JSON.stringify({ [key]: "en" });
      document.body.appendChild(script);

      const seenByStartHook: Array<unknown> = [];

      class Probe {
        readonly onStart = $hook({
          on: "start",
          handler: () => {
            seenByStartHook.push(alepha.store.get(key));
          },
        });
      }

      alepha.inject(Probe);

      // `start` only — `ready` is where the render lives and needs a router.
      await alepha.events.emit("start", alepha);

      expect(seenByStartHook).toEqual(["en"]);
    });
  });

  /**
   * `invalidate` has no caller in this repository - it is application
   * surface, reached through `useRouter().invalidate()`. These pin what it
   * carries over, which is the part a caller has to be able to predict.
   */
  describe("invalidate", () => {
    const stateKey = "alepha.react.router.state" as keyof State;

    const withLayers = () => {
      const alepha = Alepha.create();
      const provider = alepha.inject(InvalidateReactBrowserProvider);
      alepha.store.set(stateKey, {
        layers: [
          { name: "root", props: { locale: "en" } },
          { name: "folio", props: { id: "1" } },
          { name: "tab", props: { tab: "history" } },
        ],
        url: new URL("http://localhost/folio/1"),
      } as any);
      return provider;
    };

    it("carries nothing over without props, so every layer re-runs", async () => {
      const provider = withLayers();

      await provider.testInvalidate();

      expect(provider.renderCalls).toHaveLength(1);
      expect(provider.renderCalls[0].previous).toEqual([]);
    });

    it("patches the layer that owns the key and drops everything below it", async () => {
      const provider = withLayers();

      await provider.testInvalidate({ id: "2" });

      // `root` is untouched, `folio` keeps its data with the new id, and
      // `tab` is gone from `previous` — which is what makes it re-run.
      expect(provider.renderCalls[0].previous).toEqual([
        { name: "root", props: { locale: "en" } },
        { name: "folio", props: { id: "2" } },
      ]);
    });
  });

  describe("attachAnchorInterceptor", () => {
    let alepha: Alepha;
    let provider: TestReactBrowserProvider;
    let detach: () => void;
    let container: HTMLDivElement;

    const createAnchor = (
      attrs: Record<string, string>,
      inner?: HTMLElement,
    ): HTMLAnchorElement => {
      const a = document.createElement("a");
      for (const [k, v] of Object.entries(attrs)) {
        a.setAttribute(k, v);
      }
      if (inner) {
        a.appendChild(inner);
      } else {
        a.textContent = "link";
      }
      container.appendChild(a);
      return a;
    };

    const click = (
      target: HTMLElement,
      init: MouseEventInit = {},
    ): MouseEvent => {
      const ev = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      });
      target.dispatchEvent(ev);
      return ev;
    };

    beforeEach(() => {
      alepha = Alepha.create();
      provider = alepha.inject(TestReactBrowserProvider);
      container = document.createElement("div");
      document.body.appendChild(container);
      detach = provider.testAttachAnchorInterceptor();
    });

    afterEach(() => {
      detach();
      container.remove();
    });

    it("intercepts plain internal /foo anchor clicks", () => {
      const a = createAnchor({ href: "/foo" });

      const ev = click(a);

      expect(provider.pushCalls).toHaveLength(1);
      expect(provider.pushCalls[0].url).toBe("/foo");
      expect(ev.defaultPrevented).toBe(true);
    });

    it("preserves query and hash when intercepting", () => {
      const a = createAnchor({ href: "/foo?x=1#bar" });

      click(a);

      expect(provider.pushCalls[0].url).toBe("/foo?x=1#bar");
    });

    it("ignores cmd-click (metaKey)", () => {
      const a = createAnchor({ href: "/foo" });

      const ev = click(a, { metaKey: true });

      expect(provider.pushCalls).toHaveLength(0);
      expect(ev.defaultPrevented).toBe(false);
    });

    it("ignores ctrl-click", () => {
      const a = createAnchor({ href: "/foo" });

      click(a, { ctrlKey: true });

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores shift-click", () => {
      const a = createAnchor({ href: "/foo" });

      click(a, { shiftKey: true });

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores alt-click", () => {
      const a = createAnchor({ href: "/foo" });

      click(a, { altKey: true });

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores non-primary mouse buttons", () => {
      const a = createAnchor({ href: "/foo" });

      click(a, { button: 1 });

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores anchors with target='_blank'", () => {
      const a = createAnchor({ href: "/foo", target: "_blank" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores anchors with download attribute", () => {
      const a = createAnchor({ href: "/foo", download: "" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores anchors with data-no-router attribute", () => {
      const a = createAnchor({ href: "/foo", "data-no-router": "" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores mailto: hrefs", () => {
      const a = createAnchor({ href: "mailto:foo@bar.com" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores tel: hrefs", () => {
      const a = createAnchor({ href: "tel:+15555555" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores hrefs to external origins", () => {
      const a = createAnchor({ href: "https://example.com/foo" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("ignores hash-only #section hrefs", () => {
      const a = createAnchor({ href: "#section" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("intercepts when click target is nested inside the anchor", () => {
      const span = document.createElement("span");
      span.textContent = "inner";
      createAnchor({ href: "/foo" }, span);

      click(span);

      expect(provider.pushCalls).toHaveLength(1);
      expect(provider.pushCalls[0].url).toBe("/foo");
    });

    it("skips when defaultPrevented is already true", () => {
      const a = createAnchor({ href: "/foo" });
      a.addEventListener("click", (ev) => ev.preventDefault());

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });

    it("respects interceptAnchorClicks=false at runtime", () => {
      alepha.store.set(reactBrowserOptions.key, {
        ...alepha.store.get(reactBrowserOptions.key)!,
        interceptAnchorClicks: false,
      });
      const a = createAnchor({ href: "/foo" });

      click(a);

      expect(provider.pushCalls).toHaveLength(0);
    });
  });

  /**
   * `url` is what `push()` compares the committed route against and what gets
   * written back to history. Dropping the fragment here made every internal
   * `<a href="/docs#section">` land on /docs with no anchor, never scrolling.
   */
  describe("url", () => {
    it("keeps the hash fragment", () => {
      window.history.pushState({}, "", "/docs#section");

      expect(provider.url).toBe("/docs#section");
    });

    it("keeps the hash alongside the query string", () => {
      window.history.pushState({}, "", "/docs?q=1#section");

      expect(provider.url).toBe("/docs?q=1#section");
    });

    it("is unchanged when there is no hash", () => {
      window.history.pushState({}, "", "/docs?q=1");

      expect(provider.url).toBe("/docs?q=1");
    });
  });
});

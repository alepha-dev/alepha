import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReactBrowserProvider,
  type RouterPushOptions,
  reactBrowserOptions,
} from "../providers/ReactBrowserProvider.ts";

class TestReactBrowserProvider extends ReactBrowserProvider {
  public testGetHydrationState = this.getHydrationState.bind(this);
  public testAttachAnchorInterceptor = this.attachAnchorInterceptor.bind(this);
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
});

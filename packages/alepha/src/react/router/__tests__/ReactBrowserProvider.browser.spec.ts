import { Alepha } from "alepha";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";

class TestReactBrowserProvider extends ReactBrowserProvider {
  public testGetHydrationState = this.getHydrationState.bind(this);
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
});

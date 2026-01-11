import { AlephaReactHead, BrowserHeadProvider, type Head } from "@alepha/react/head";
import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { $page } from "../index.browser.ts";

describe("$page head integration (browser)", () => {
  let provider: BrowserHeadProvider;

  class TestApp {
    simplePage = $page({
      path: "/",
      head: {
        title: "Simple Page",
        bodyAttributes: { class: "simple-page" },
      },
      component: () => "Simple content",
    });

    complexPage = $page({
      path: "/complex",
      head: {
        title: "Complex Page",
        htmlAttributes: {
          lang: "en",
          "data-theme": "dark",
        },
        bodyAttributes: {
          class: "complex-page",
          style: "background: black;",
        },
        meta: [
          { name: "description", content: "Complex test page" },
          {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          },
        ],
      },
      component: () => "Complex content",
    });
  }

  beforeEach(() => {
    // Reset document state
    document.title = "";
    document.head.innerHTML = "";
    document.body.removeAttribute("class");
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("class");
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.body.querySelector("#root")?.remove();
  });

  it("should render simple page head configuration", async () => {
    const alepha = Alepha.create().with(AlephaReactHead).with(TestApp);
    await alepha.start();

    expect(document.title).toBe("Simple Page");
    expect(document.body.getAttribute("class")).toBe("simple-page");
  });

  it("should get current head state and match page configuration", async () => {
    const alepha = Alepha.create().with(AlephaReactHead);
    provider = alepha.inject(BrowserHeadProvider);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // Apply complex page head
    const headConfig = app.complexPage.options.head as Head;
    provider.renderHead(document, headConfig);

    // Get current head state
    const currentHead = provider.getHead(document);

    expect(currentHead.title).toBe(headConfig.title);
    expect(currentHead.htmlAttributes?.lang).toBe(
      headConfig.htmlAttributes?.lang,
    );
    expect(currentHead.bodyAttributes?.class).toBe(
      headConfig.bodyAttributes?.class,
    );
    expect(currentHead.meta).toContainEqual({
      name: "description",
      content: "Complex test page",
    });
  });
});

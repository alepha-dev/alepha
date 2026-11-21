import { Alepha } from "alepha";
import { AlephaReactHead } from "alepha/react/head";
import { afterEach, beforeEach, describe, it } from "vitest";

import { $page } from "../index.browser.ts";

describe("$page head integration (browser)", () => {
  class TestApp {
    simplePage = $page({
      path: "/",
      head: {
        title: "Simple Page",
        bodyAttributes: { class: "simple-page" },
      },
      component: () => "Simple content",
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

  it("should render simple page head configuration", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaReactHead).with(TestApp);
    await alepha.start();

    expect(document.title).toBe("Simple Page");
    expect(document.body.getAttribute("class")).toBe("simple-page");
  });
});

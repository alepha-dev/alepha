import { Alepha } from "@alepha/core";
import { dom } from "@alepha/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { $page } from "../src/descriptors/$page.ts";
import { AlephaReact } from "../src/index.browser.ts";
import { ReactRouter } from "../src/services/ReactRouter.ts";

describe("$page browser tests", () => {
  let alepha: Alepha;

  beforeEach(() => {
    // Reset document state
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("should render home page via router.go", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div data-testid="home">Welcome Home</div>,
      });
    }

    alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();

    const router = alepha.inject(ReactRouter);

    await dom.act(async () => {
      await router.go("/");
    });

    await dom.waitFor(() => {
      const element = document.querySelector('[data-testid="home"]');
      expect(element).toBeDefined();
      expect(element?.textContent).toBe("Welcome Home");
    });
  });

  it("should navigate between pages", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div data-testid="home">Home</div>,
      });

      about = $page({
        path: "/about",
        component: () => <div data-testid="about">About Us</div>,
      });
    }

    alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();

    const router = alepha.inject(ReactRouter);

    // Navigate to home
    await dom.act(async () => {
      await router.go("/");
    });

    await dom.waitFor(() => {
      expect(document.querySelector('[data-testid="home"]')).toBeDefined();
    });

    // Navigate to about
    await dom.act(async () => {
      await router.go("/about");
    });

    await dom.waitFor(() => {
      expect(document.querySelector('[data-testid="about"]')).toBeDefined();
      expect(document.querySelector('[data-testid="about"]')?.textContent).toBe(
        "About Us",
      );
    });
  });
});

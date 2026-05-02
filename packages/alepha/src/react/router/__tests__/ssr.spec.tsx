import { Alepha } from "alepha";
import { beforeEach, describe, test } from "vitest";
import { $page, NestedView } from "../index.ts";

describe("$page ssr option", () => {
  let alepha: Alepha;

  beforeEach(() => {
    alepha = Alepha.create();
  });

  test("default (no ssr option) renders server-side", async ({ expect }) => {
    class App {
      home = $page({
        path: "/",
        component: () => "Home content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.home.render();
    expect(rendered.html).toBe("Home content");
  });

  test("ssr: true renders server-side", async ({ expect }) => {
    class App {
      home = $page({
        path: "/",
        ssr: true,
        component: () => "Home content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.home.render();
    expect(rendered.html).toBe("Home content");
  });

  test("ssr: false skips server rendering on a leaf page", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/",
        ssr: false,
        component: () => "Home content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.home.render();
    expect(rendered.html).toBe("");
  });

  test("ssr: false still runs the loader server-side", async ({ expect }) => {
    let loaderCalls = 0;

    class App {
      home = $page({
        path: "/",
        ssr: false,
        loader: () => {
          loaderCalls += 1;
          return { msg: "loaded" };
        },
        component: ({ msg }: { msg: string }) => msg,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.home.render();
    expect(rendered.html).toBe("");
    expect(loaderCalls).toBe(1);
  });

  test("parent ssr: false cascades to child without override", async ({
    expect,
  }) => {
    class App {
      parent = $page({
        path: "/parent",
        ssr: false,
        component: () => (
          <>
            Parent
            <NestedView />
          </>
        ),
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        component: () => "Child",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.child.render();
    expect(rendered.html).toBe("");
  });

  test("child ssr: true overrides parent ssr: false (both render)", async ({
    expect,
  }) => {
    class App {
      parent = $page({
        path: "/parent",
        ssr: false,
        component: () => (
          <>
            Parent
            <NestedView />
          </>
        ),
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        ssr: true,
        component: () => "Child",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.child.render();
    expect(rendered.html).toBe("Parent<!-- -->Child");
  });

  test("child ssr: false overrides parent ssr: true (skip everything)", async ({
    expect,
  }) => {
    class App {
      parent = $page({
        path: "/parent",
        ssr: true,
        component: () => (
          <>
            Parent
            <NestedView />
          </>
        ),
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        ssr: false,
        component: () => "Child",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.child.render();
    expect(rendered.html).toBe("");
  });

  test("siblings: one inherits parent ssr: false, the other overrides", async ({
    expect,
  }) => {
    class App {
      parent = $page({
        path: "/parent",
        ssr: false,
        component: () => (
          <>
            Parent
            <NestedView />
          </>
        ),
      });

      home = $page({
        path: "/home",
        parent: this.parent,
        ssr: true,
        component: () => "Home",
      });

      about = $page({
        path: "/about",
        parent: this.parent,
        component: () => "About",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const home = await app.home.render();
    expect(home.html).toBe("Parent<!-- -->Home");

    const about = await app.about.render();
    expect(about.html).toBe("");
  });

  test("3-level chain: nearest explicit ssr wins (leaf decides)", async ({
    expect,
  }) => {
    class App {
      grand = $page({
        path: "/grand",
        ssr: false,
        component: () => (
          <>
            Grand
            <NestedView />
          </>
        ),
      });

      // no ssr → inherits from grand → false (default for descendants)
      mid = $page({
        path: "/mid",
        parent: this.grand,
        component: () => (
          <>
            Mid
            <NestedView />
          </>
        ),
      });

      // explicit ssr: true → overrides inherited false
      leaf = $page({
        path: "/leaf",
        parent: this.mid,
        ssr: true,
        component: () => "Leaf",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.leaf.render();
    expect(rendered.html).toBe("Grand<!-- -->Mid<!-- -->Leaf");
  });

  test("3-level chain: middle ssr: true does not affect leaf without explicit value", async ({
    expect,
  }) => {
    class App {
      grand = $page({
        path: "/grand",
        ssr: false,
        component: () => (
          <>
            Grand
            <NestedView />
          </>
        ),
      });

      // explicit true overrides grand's false for itself + descendants default
      mid = $page({
        path: "/mid",
        parent: this.grand,
        ssr: true,
        component: () => (
          <>
            Mid
            <NestedView />
          </>
        ),
      });

      // no ssr → walks up: mid.ssr === true → leaf renders
      leaf = $page({
        path: "/leaf",
        parent: this.mid,
        component: () => "Leaf",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.leaf.render();
    expect(rendered.html).toBe("Grand<!-- -->Mid<!-- -->Leaf");
  });

  test("parent ssr: false: loaders still run for parent and child", async ({
    expect,
  }) => {
    let parentLoaderCalls = 0;
    let childLoaderCalls = 0;

    class App {
      parent = $page({
        path: "/parent",
        ssr: false,
        loader: () => {
          parentLoaderCalls += 1;
          return { fromParent: "p" };
        },
        component: () => (
          <>
            Parent
            <NestedView />
          </>
        ),
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        loader: ({ fromParent }) => {
          childLoaderCalls += 1;
          return { fromChild: `${fromParent}-c` };
        },
        component: ({ fromChild }: { fromChild: string }) => fromChild,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.child.render();
    expect(rendered.html).toBe("");
    expect(parentLoaderCalls).toBe(1);
    expect(childLoaderCalls).toBe(1);
  });
});

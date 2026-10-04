import { Alepha } from "alepha";
import { $head, AlephaReactHead } from "alepha/react/head";
import { describe, it } from "vitest";

import { $page } from "../index.ts";

class AppNoHead {
  home = $page({
    component: () => "Home",
  });
}

const alepha1 = Alepha.create().with(AlephaReactHead);
const app1 = alepha1.inject(AppNoHead);

describe("Head defaults", () => {
  it("should use lang=en and title=App when no head is configured", async ({
    expect,
  }) => {
    const result = await app1.home.render({ html: true, hydration: false });

    expect(result.html).toContain('<html lang="en">');
    expect(result.html).toContain("<title>App</title>");
  });
});

class AppWithHead {
  head = $head({
    title: "My Site",
    htmlAttributes: { lang: "fr" },
  });

  home = $page({
    component: () => "Home",
  });
}

const alepha2 = Alepha.create().with(AlephaReactHead);
const app2 = alepha2.inject(AppWithHead);

describe("Head overrides", () => {
  it("should use custom lang and title when configured", async ({ expect }) => {
    const result = await app2.home.render({ html: true, hydration: false });

    expect(result.html).toContain('<html lang="fr">');
    expect(result.html).toContain("<title>My Site</title>");
    expect(result.html).not.toContain('<html lang="en">');
    expect(result.html).not.toContain("<title>App</title>");
  });
});

class AppWithViewport {
  head = $head({
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  });

  home = $page({
    component: () => "Home",
  });
}

describe("Head viewport", () => {
  it("writes a global $head viewport into the document's early head", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaReactHead);
    const app = alepha.inject(AppWithViewport);
    await alepha.start();

    const result = await app.home.render({ html: true, hydration: false });

    expect(result.html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    );
    expect(result.html.match(/name="viewport"/g)).toHaveLength(1);
    await alepha.stop();
  });
});

describe("App shell viewport", () => {
  it("lets the shell's viewport replace the app's own, and only the shell's", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaReactHead);
    const app = alepha.inject(AppWithHead);
    await alepha.start();

    const event: { html?: string; viewport?: string } = {
      viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
    };
    await alepha.events.emit("react:server:shell", event);
    const page = await app.home.render({ html: true, hydration: false });

    expect(event.html).toContain("viewport-fit=cover");
    expect(event.html?.match(/name="viewport"/g)).toHaveLength(1);
    expect(page.html).not.toContain("viewport-fit=cover");
    await alepha.stop();
  });
});

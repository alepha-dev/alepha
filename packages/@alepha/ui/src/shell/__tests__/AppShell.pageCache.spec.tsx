import { Alepha } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { AlephaReactUi, uiAtom } from "alepha/react/ui";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AppShell } from "../AppShell.tsx";

/**
 * An `AppShell` page reads no UI preference on the server (#E78): its markup
 * is the same whatever the visitor's `alepha-ui` cookie says, so the page
 * cache shares it between visitors who prefer different things.
 */
describe("AppShell and the page cache", () => {
  class App {
    layout = $page({
      component: () => <AppShell brand="Brand" nav={[]} />,
      children: () => [this.home],
    });

    home = $page({
      path: "/",
      stream: false,
      component: () => "home",
    });
  }

  const cookie = (ui: object) =>
    `alepha-ui=${encodeURIComponent(JSON.stringify(ui))}`;

  it("serves the same cached page to visitors with different ui cookies", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(AlephaReactUi)
      .with(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;

    const collapsedDark = cookie({
      ...uiAtom.options.default!,
      mode: "dark",
      sidebar: { collapsed: true },
    });

    const first = await fetch(`${base}/`, {
      headers: { cookie: collapsedDark },
    });
    const firstBody = await first.text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await fetch(`${base}/`);
    const secondBody = await second.text();

    // Variant, not shared: the shell is translated, so it reads the language,
    // which every key carries anyway.
    expect(first.headers.get("x-alepha-cache")).toBe("miss; verdict=variant");
    expect(second.headers.get("x-alepha-cache")).toBe("hit; verdict=variant");

    // The shared part is identical; only each visitor's private script differs.
    const shared = (html: string) =>
      html.replace(/<script id="__ssr_private"[^>]*>.*?<\/script>/, "");
    expect(shared(secondBody)).toBe(shared(firstBody));
  });
});

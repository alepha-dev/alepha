import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import NotFoundPage from "./NotFoundPage.tsx";

/**
 * The one route the page links to, under the name the real router gives it.
 */
class Routes {
  home = $page({
    name: "home",
    path: "/",
    component: () => null,
  });
}

/**
 * Lore's 404. It replaced the framework's default, which is a number and a
 * sentence: a member who landed on it had nothing to click and took the app
 * for stuck (feedback #P2228, quest #Q3269).
 */
describe("NotFoundPage", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (lang: "en" | "fr" = "en") => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);

    return render(
      <AlephaContext.Provider value={alepha}>
        <NotFoundPage />
      </AlephaContext.Provider>,
    );
  };

  it("says what happened", async ({ expect }) => {
    const ui = await mount();

    expect(ui.container.textContent).toContain("404");
    expect(ui.container.textContent).toContain("Page not found");
  });

  it("offers a link home", async ({ expect }) => {
    await mount();

    // A link, not a button with a click handler: it has to be a real anchor
    // so it opens in a new tab and shows where it goes.
    const link = await screen.findByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("is translated", async ({ expect }) => {
    const ui = await mount("fr");

    expect(ui.container.textContent).toContain("Page introuvable");
    expect(await screen.findByRole("link", { name: "Accueil" })).toBeDefined();
  });
});

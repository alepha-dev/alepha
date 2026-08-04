import { AuthRouter } from "@alepha/ui/components/auth/auth-router";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.tsx";
import { panierAtom } from "./panierAtom.ts";
import { ShopI18n } from "./ShopI18n.ts";

/**
 * Atelier Aurore — the browser half.
 *
 * `AlephaReactAuth` supplies the login/register/reset screens and the session
 * plumbing behind `<ButtonUser />`; `AlephaReactUi` the colour-scheme store the
 * theme toggle writes to; `AlephaReactI18n` the dictionaries behind `tr()` and
 * the `<ButtonLanguage />` switch. None is worth hand-rolling, and the storefront
 * gets all three by importing them.
 *
 * ⚠️ The interface is bilingual; the **catalogue is not**. Product names and
 * descriptions are single-language rows, so an English visitor still reads
 * "Collier Aurore · Argent · 4,2 g". Localising catalogue copy needs per-locale
 * columns or a translations table, and that decision belongs to a shop with a
 * second market — see the note in `ShopI18n`.
 *
 * @module shop.web
 */
export const ShopWeb = $module({
  name: "shop.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  atoms: [panierAtom],
  /*
   * `AuthRouter` is the whole sign-in surface: it mounts `/auth/login`,
   * `/auth/register`, `/auth/reset-password` and `/auth/verify-email`, loads the
   * realm configuration for each, and points their cross-links at each other.
   *
   * Registering it replaced three hand-written pages under `/compte/*`. Those
   * gave the shop French URLs and its own auth shell, but the price was keeping
   * every internal link right by hand — the components fall back to the
   * framework's `/auth/*` paths, so a missed prop is a 404 that typecheck, unit
   * tests and a URL-driven e2e suite all render invisible. The shop had already
   * been bitten by it once.
   */
  services: [AppRouter, AuthRouter, ShopI18n],
  register: (alepha) => {
    // French is the atelier's own language, so it is the fallback rather than
    // the framework's default of English. `autoDetect` stays on: a first-time
    // visitor whose browser asks for English gets English, and the choice is
    // then remembered in the `lang` cookie — which is what lets the server
    // render the same language the client will hydrate with.
    const i18n = alepha.inject(I18nProvider).options;
    i18n.fallbackLang = "fr";

    /*
     * Locale prefixes, for search engines.
     *
     * Each language becomes a distinct crawlable URL, and the URL is the source
     * of truth — it wins over the cookie and over `Accept-Language`, with no
     * redirect. French is `fallbackLang`, so it stays unprefixed (`/piece/…`) and
     * English takes the prefix (`/en/piece/…`). There is deliberately no `/fr/`:
     * putting the atelier's own language behind a prefix would mean making
     * English the default, and every existing URL would move.
     *
     * This also removes the last way the server and client can disagree about
     * language, on top of the resolved language now being hydrated.
     */
    i18n.routing = "prefix";
  },
});

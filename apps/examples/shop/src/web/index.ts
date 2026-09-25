import { AlephaSigil } from "@alepha/lore/sigil";
import { AccountRouter } from "@alepha/ui/account";
import { AdminRouter } from "@alepha/ui/admin";
import { AuthRouter } from "@alepha/ui/auth";
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
 * `AlephaSigil` reports page views, Web Vitals and grouped errors to the sink
 * named by `SIGIL_SINK` (defaulting to the public Lore instance), under the
 * `shop-production` sigil, which lives in Lore project 1 (Alepha) rather than
 * a shop project of its own, that one having been merged away. Nothing here
 * says so: the project rides in `SIGIL_KEY`, which is shaped
 * `sg_alepha_<secret>` for exactly that reason. It is inert without
 * `SIGIL_KEY` and inert outside production, so dev and the e2e suite send
 * nothing.
 *
 * ⚠️ This used to claim importing the module mounts nothing and the storefront
 * gets no floating feedback button. It does get one: `<SigilRoot />` is pushed
 * into the root component list by the module itself, and production has been
 * serving the button at bottom-right this whole time. Whether a shop wants it
 * is a real question, and the answer is one field away either way:
 * `SIGIL_CONFIG={"feedbackButton":"hidden"}` keeps the URL and drops the
 * control.
 *
 * @module shop.web
 */
export const ShopWeb = $module({
  name: "shop.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi, AlephaSigil],
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
   *
   * `AdminRouter` supplies the whole `/admin` shell and its ten built-in
   * pages; `AppRouter` hangs three commerce pages off its public `layout`
   * field (see `AppRouter.tsx`'s "Back office" section). Its chrome is
   * configured via `adminRouterOptionsAtom`, set from both `main.server.ts`
   * and `main.browser.ts` (see `./adminChrome.tsx`).
   *
   * `AccountRouter` is the customer's own `/account` area: profile, security,
   * sessions, API keys, connections. It is a root shell like `/admin`, with
   * its own sidebar and a "Back to site" item, never adopted into the
   * storefront layout (whose `Toaster` would show every toast twice). Its
   * chrome is `./accountChrome.tsx`, set beside the admin one.
   */
  services: [AppRouter, AuthRouter, AdminRouter, AccountRouter, ShopI18n],
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
     * redirect. French is `fallbackLang`, so it stays unprefixed (`/produit/…`)
     * and English takes the prefix (`/en/produit/…`). There is deliberately no
     * `/fr/`:
     * putting the atelier's own language behind a prefix would mean making
     * English the default, and every existing URL would move.
     *
     * This also removes the last way the server and client can disagree about
     * language, on top of the resolved language now being hydrated.
     */
    i18n.routing = "prefix";

    /*
     * …but only for the shop. `/admin` and `/account` are behind a sign-in, so
     * there is no crawler to give a second URL to and nothing the prefix buys
     * — while switching language from the back office moved the operator to
     * `/en/admin`, which is a URL the storefront's SEO scheme invented for a
     * page no search engine will ever see.
     *
     * Inside these two, language falls back to the `lang` cookie, exactly as it
     * works in an app that never turned prefix routing on.
     */
    i18n.routingExclude = ["/admin", "/account"];
  },
});

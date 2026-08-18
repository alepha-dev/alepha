import { AlephaSigil } from "@alepha/sigil";
import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { accountRouterOptionsAtom } from "@alepha/ui/components/account/account-router-options";
import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
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
 * `AlephaSigil` reports page views, Web Vitals and grouped errors to the sink
 * named by `SIGIL_SINK` (defaulting to the public Lore instance), under the
 * `shop-production` sigil. It is inert without `SIGIL_KEY` and inert outside
 * production, so dev and the e2e suite send nothing. Nothing is mounted in the
 * tree by importing it: the storefront gets no floating feedback button, which
 * is the right default for a shop.
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
   * `AccountRouter` is the customer's own `/account` area — profile, security,
   * sessions, API keys, connections. `AppRouter` adopts its `layout` into the
   * storefront shell so those pages keep the atelier's header and footer; it is
   * listed here as well, as the honest declaration of what the app mounts, the
   * same way `AdminRouter` is despite `$pageAdmin` already pulling it in.
   */
  services: [AppRouter, AuthRouter, AdminRouter, AccountRouter, ShopI18n],
  register: (alepha) => {
    /*
     * No second header on the account pages.
     *
     * `AccountRouter` ships one — a back link plus the language / theme /
     * account controls — for an area mounted standalone at the root. The shop
     * adopts it into `AppRouter.layout` instead, which already renders exactly
     * those controls in the atelier's own header, so the default would paint a
     * second row of the same buttons under the first. `null` is the documented
     * value for that case, and `AccountLayout` tests `!== undefined` precisely
     * so it can tell "nested, drop the bar" from "not configured".
     *
     * It also removes a real crash rather than only a duplicate: the default
     * header's back link resolves the route name `home`, and the storefront
     * root is named `accueil` (its property key), so rendering it threw
     * `Page 'home' not found` on every account page. `adminChrome.tsx` answers
     * the same mismatch with `homeRouteName: "accueil"` — the right fix there,
     * because `/admin` is a standalone shell that does need its own way out.
     *
     * Set here rather than in `main.*.ts` (where the admin options live)
     * because this value carries no JSX: `register` runs in both the server and
     * the browser container, so one call covers both.
     */
    alepha.store.set(accountRouterOptionsAtom, { header: null });

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

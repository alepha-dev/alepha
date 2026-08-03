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
  services: [AppRouter, ShopI18n],
  register: (alepha) => {
    // French is the atelier's own language, so it is the fallback rather than
    // the framework's default of English. `autoDetect` stays on: a first-time
    // visitor whose browser asks for English gets English, and the choice is
    // then remembered in the `lang` cookie — which is what lets the server
    // render the same language the client will hydrate with.
    alepha.inject(I18nProvider).options.fallbackLang = "fr";
  },
});

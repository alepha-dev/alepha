import { $atom, z } from "alepha";

/**
 * The language resolved for the current request, carried to the browser.
 *
 * ### Why this is an atom and not just a store key
 *
 * The value has always been written to `alepha.react.i18n.lang` — but as a plain
 * `State` key, and `buildHydrationData` serializes only `store.exportAtoms()`. So
 * the server's decision never reached the client: it resolved a language from
 * `Accept-Language`, rendered in it, and told nobody. The client then booted,
 * looked for the `lang` cookie (absent on a first visit, since the cookie is only
 * written when somebody *chooses* a language), found nothing, and started from
 * `fallbackLang`.
 *
 * On a bilingual site that means the first page a visitor ever sees is rendered
 * in one language on the server and repainted in another on hydration —
 * `lang="en"` in the markup, French in the DOM, and React error #418 in the
 * console. It hits exactly the visitors who arrive from a link or a search
 * engine, plus every crawler, and it is invisible to anyone whose browser happens
 * to ask for the fallback language.
 *
 * Naming the atom after the existing key is what keeps the change small: every
 * `store.get`/`store.set("alepha.react.i18n.lang", …)` call site keeps working,
 * because an atom's store key *is* its name. Registering it is the whole fix —
 * `exportAtoms` then finds it and the client starts where the server left off.
 *
 * This mirrors `alepha/react/ui`'s `uiAtom`, which solved the same
 * server-decides-client-must-agree problem for the colour scheme.
 *
 * No `default`: an unset value must stay `undefined` so `exportAtoms` skips it
 * and `I18nProvider.lang` falls through to `fallbackLang`, exactly as before.
 */
export const langAtom = $atom({
  name: "alepha.react.i18n.lang",
  schema: z.text().optional(),
  default: undefined,
});

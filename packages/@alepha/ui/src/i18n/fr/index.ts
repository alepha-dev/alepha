/**
 * The French catalogue for every key `@alepha/ui` asks for.
 *
 * A plain record the application spreads into its own catalogue, and a subpath
 * of its own so that catalogue can load it lazily:
 *
 * ```ts
 * fr = $dictionary({
 *   lazy: async () => {
 *     const { uiFr } = await import("@alepha/ui/i18n/fr");
 *     return { default: { ...uiFr, "nav.home": "Accueil" } };
 *   },
 * });
 * ```
 *
 * @module alepha.ui.i18n.fr
 */

export { uiFr } from "./uiFr.ts";

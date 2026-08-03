/**
 * French strings for the components in this package.
 *
 * ### Why this is a plain object and not a `$dictionary`
 *
 * `@alepha/ui` is a component library, not a module: it has no `$module`, no
 * entry point and no DI of its own — a consumer imports the components it wants
 * and nothing else. Shipping a `$dictionary` here would mean giving the package a
 * container to register into, which is a much larger change than the problem
 * warrants.
 *
 * So this is a record the application spreads into *its* catalogue:
 *
 * ```ts
 * import { uiFr } from "@alepha/ui/lib/i18n-fr";
 *
 * export class AppI18n {
 *   fr = $dictionary({
 *     lazy: async () => ({ default: { ...uiFr, ...mesClés } }),
 *   });
 * }
 * ```
 *
 * Spread first so the application always wins on a key it also defines.
 *
 * ### Why it exists at all
 *
 * The components already call `tr("…", { default: "English" })`, which reads as
 * "translatable" but behaves as "English unless somebody defines the key". Nobody
 * did, so a French application got a French interface with English dialogs — a
 * confirmation that said "Cancel / Confirm" and a table whose menu announced
 * "Open row actions". `locale: "fr-FR"` changed nothing, because the browser
 * language was never the problem: the catalogue was.
 *
 * Keys use `$1` for interpolation, matching `tr`'s `args`.
 */
export const uiFr: Record<string, string> = {
  // use-dialog — the imperative confirm/alert/prompt
  "useDialog.confirm": "Confirmer",
  "useDialog.cancel": "Annuler",
  "useDialog.ok": "OK",

  // alepha-table
  "alephaTable.empty": "Aucun résultat.",
  "alephaTable.refresh": "Actualiser",
  "alephaTable.columns": "Colonnes",
  "alephaTable.toggleColumns": "Afficher ou masquer des colonnes",
  "alephaTable.resetFilters": "Réinitialiser les filtres",
  "alephaTable.selected": "$1 sélectionné(s)",
  "alephaTable.clearSelection": "Annuler la sélection",
  "alephaTable.selectAll": "Sélectionner toutes les lignes",
  "alephaTable.selectRow": "Sélectionner la ligne",
  "alephaTable.openRowActions": "Ouvrir les actions de la ligne",

  /*
   * auth — sign-in and registration.
   *
   * Only the keys the two credential screens use. Phone, username and OAuth are
   * off in most realms, and translating copy nobody renders is how a catalogue
   * rots.
   */
  "auth.login.email": "Adresse e-mail",
  "auth.login.identifier": "Adresse e-mail",
  "auth.login.password": "Mot de passe",
  "auth.login.submit": "Se connecter",
  "auth.login.forgot": "Mot de passe oublié ?",
  "auth.login.noAccount": "Pas encore de compte ?",
  "auth.login.signUp": "Créer un compte",
  "auth.login.cancel": "Annuler",
  "auth.login.invalid": "Adresse e-mail ou mot de passe incorrect",
  "auth.login.error": "Une erreur est survenue. Merci de réessayer.",
  "auth.register.email": "Adresse e-mail",
  "auth.register.password": "Mot de passe",
  "auth.register.firstName": "Prénom",
  "auth.register.lastName": "Nom",
  "auth.register.submit": "Créer mon compte",
  "auth.register.haveAccount": "Vous avez déjà un compte ?",
  "auth.register.signIn": "Se connecter",
  "auth.register.cancel": "Annuler",
  "auth.register.disabled": "Les inscriptions sont fermées pour le moment.",
  "auth.register.password.rule.minLength": "8 caractères au minimum",
  "auth.register.password.rule.uppercase": "Une majuscule",
  "auth.register.password.rule.lowercase": "Une minuscule",
  "auth.register.password.rule.number": "Un chiffre",
  "auth.register.password.rule.special": "Un caractère spécial",
};

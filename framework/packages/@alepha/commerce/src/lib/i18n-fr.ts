/**
 * French strings for `@alepha/commerce`'s back-office components.
 *
 * ### Why this exists
 *
 * The components call `tr("…", { default: "English" })`, which reads as
 * "translatable" and behaves as "English unless somebody defines the key".
 * Until this file, nobody did, and the defaults were French, so the package
 * shipped a French back office to every application regardless of language.
 * `apps/examples/shop` is bilingual and its English admin was French throughout.
 *
 * Flipping the defaults to English fixed the English half and would have left
 * the French half worse, so the two moved together: English in the component,
 * French here.
 *
 * ### How to use it
 *
 * Same shape as `@alepha/ui`'s `uiFr`: a plain record the application spreads
 * into *its* catalogue, because this package is a library with no container of
 * its own to register a `$dictionary` into:
 *
 * ```ts
 * import { commerceFr } from "@alepha/commerce/lib/i18n-fr";
 *
 * export class ShopI18n {
 *   fr = $dictionary({
 *     lazy: async () => ({ default: { ...uiFr, ...commerceFr, ...mesClés } }),
 *   });
 * }
 * ```
 *
 * Spread it first so the application always wins on a key it also defines.
 *
 * ### ⚠️ A key defined here and nowhere else renders French in English
 *
 * `tr()` falls back to the application's `fallbackLang` dictionary before it
 * falls back to the `default:` in the component. So in an app whose
 * `fallbackLang` is `"fr"` (the shop), defining a key here without an English
 * twin does not leave English untranslated, it makes English render the
 * French. The English lives in the component's own `default:`, which is why
 * these two must be edited as a pair.
 *
 * ### Vocabulary
 *
 * Deliberately generic commerce French ("produit", "mode de livraison")
 * rather than any one shop's voice. `apps/examples/shop` is a jewellery atelier and
 * says "pièce" for a product; it overrides the handful of keys where that
 * matters in its own catalogue, which is exactly what spreading this first
 * is for.
 */
export const commerceFr: Record<string, string> = {
  // Catalogue: list, publish, restock
  "commerce.admin.noProducts": "Aucun produit au catalogue.",
  "commerce.admin.newProduct": "Nouveau produit",
  "commerce.admin.edit": "Modifier",
  "commerce.admin.publish": "Mettre en vente",
  "commerce.admin.publishTitle": "Mettre en vente",
  "commerce.admin.publishConfirm": "« $1 » sera visible et achetable.",
  "commerce.admin.unpublish": "Retirer de la vente",
  "commerce.admin.unpublishTitle": "Retirer de la vente",
  "commerce.admin.unpublishConfirm":
    "« $1 » disparaîtra de la boutique. Les commandes déjà passées ne changent pas.",
  "commerce.admin.restock": "Réapprovisionner",
  "commerce.admin.restockTitle": "Réapprovisionner",
  "commerce.admin.restockConfirm": "Ajouter une unité de « $1 » au stock ?",
  "commerce.admin.restocked": "« $1 » : +1 en stock.",
  "commerce.admin.saved": "Produit enregistré.",
  "commerce.admin.allKinds": "Tous les types",

  // Catalogue: columns
  "commerce.admin.colName": "Produit",
  "commerce.admin.colKind": "Type",
  "commerce.admin.colPrice": "Prix",
  "commerce.admin.colStock": "Stock",
  "commerce.admin.colStatus": "Statut",
  "commerce.admin.colCreated": "Ajouté",
  "commerce.admin.reserved": "réservés",
  "commerce.admin.online": "En ligne",
  "commerce.admin.draft": "Brouillon",

  // Catalogue: editor
  "commerce.admin.fName": "Nom",
  "commerce.admin.fSlug": "Référence",
  "commerce.admin.fSlugHint":
    "Apparaît dans l'URL. Ne le changez plus après la mise en vente.",
  "commerce.admin.fKind": "Type",
  "commerce.admin.fPrice": "Prix TTC (centimes)",
  "commerce.admin.fDescription": "Description",
  "commerce.admin.fPublished": "En vente",
  "commerce.admin.save": "Enregistrer",
  "commerce.admin.availableLabel": "Disponible",
  "commerce.admin.onHandLabel": "En stock",
  "commerce.admin.reservedLabel": "Réservé",

  // Commandes
  "commerce.admin.noOrders": "Aucune commande.",
  "commerce.admin.allStatuses": "Tous les statuts",
  "commerce.admin.ship": "Expédier",
  "commerce.admin.shipTitle": "Confier au transporteur",
  "commerce.admin.shipHint":
    "Numéro de suivi, s'il y en a un. Le client le reçoit par courriel.",
  "commerce.admin.shipConfirm": "Expédier",
  "commerce.admin.deliver": "Marquer reçue",
  "commerce.admin.deliverTitle": "Marquer comme reçue",
  "commerce.admin.deliverConfirm": "Le client a confirmé avoir reçu le colis ?",
  "commerce.admin.refund": "Rembourser",
  "commerce.admin.refundTitle": "Rembourser",
  "commerce.admin.refundConfirm":
    "Rembourser $1 au client ? L'argent repart chez lui et le stock est libéré. Un avoir sera émis.",
  "commerce.admin.refunded": "Commande remboursée.",
  "commerce.admin.colWhen": "Date",
  "commerce.admin.colTotal": "Total",
  "commerce.admin.colShipping": "Livraison",
  "commerce.admin.loading": "Chargement…",
  "commerce.admin.lines": "Articles",
  "commerce.admin.shippingLine": "Livraison",
  "commerce.admin.vat": "dont TVA",
  "commerce.admin.address": "Adresse de livraison",

  /*
   * Statuts de commande. Rendus via `tr(\`commerce.status.${status}\`)`, dont
   * le `default:` est l'identifiant brut, donc sans ces clés, une commande
   * affiche "fulfilled" dans les deux langues, pas seulement en français.
   */
  "commerce.status.pending": "En attente",
  "commerce.status.paid": "Payée",
  "commerce.status.fulfilled": "Préparée",
  "commerce.status.shipped": "Expédiée",
  "commerce.status.delivered": "Reçue",
  "commerce.status.cancelled": "Annulée",
  "commerce.status.refunded": "Remboursée",

  // Livraison: modes et tarifs
  "commerce.admin.noRates": "Aucun mode de livraison dans cette zone.",
  "commerce.admin.newRate": "Nouveau mode",
  "commerce.admin.withdraw": "Retirer",
  "commerce.admin.withdrawRate": "Retirer ce mode",
  "commerce.admin.withdrawRateConfirm":
    "« $1 » ne sera plus proposé au checkout. Les commandes passées le gardent, et vous pourrez le remettre plus tard.",
  "commerce.admin.rateName": "Mode",
  "commerce.admin.ratePrice": "Tarif",
  "commerce.admin.freeAbove": "Offert dès",
  "commerce.admin.delay": "Délai",
  "commerce.admin.offered": "Proposé",
  "commerce.admin.withdrawn": "Retiré",
  "commerce.admin.rateCode": "Code",
  "commerce.admin.rateCodeHint":
    "Écrit sur la commande. Ne le changez plus ensuite.",
  "commerce.admin.ratePriceCents": "Tarif TTC (centimes)",
  "commerce.admin.freeAboveCents": "Offert à partir de (centimes)",
  "commerce.admin.minDays": "Délai min. (jours)",
  "commerce.admin.maxDays": "Délai max. (jours)",

  // -- Product detail page --------------------------------------------------
  "commerce.admin.draftFailed": "Impossible de créer le produit",
  "commerce.admin.fCurrency": "Devise",
  "commerce.admin.fVatRate": "Taux de TVA (points de base)",
  "commerce.admin.fVatRateHint":
    "2000 = 20,00 %. Laissez vide pour appliquer le taux par défaut du vendeur.",

  "commerce.admin.detail.id": "Identifiant",
  "commerce.admin.detail.slug": "Référence",
  "commerce.admin.detail.kind": "Type",
  "commerce.admin.detail.price": "Prix",
  "commerce.admin.detail.vat": "TVA",
  "commerce.admin.detail.vatDefault": "Taux par défaut",
  "commerce.admin.detail.status": "Statut",
  "commerce.admin.detail.created": "Créé le",
  "commerce.admin.detail.tabOverview": "Résumé",
  "commerce.admin.detail.tabMedia": "Images",
  "commerce.admin.detail.tabDetails": "Détails",
  "commerce.admin.detail.tabStock": "Stock",
  "commerce.admin.detail.tabOrders": "Ventes",
  "commerce.admin.detail.loadError": "Impossible de charger le produit",
  "commerce.admin.detail.notFound": "Produit introuvable.",
  "commerce.admin.detail.back": "Retour au catalogue",
  "commerce.admin.detail.delete": "Supprimer",
  "commerce.admin.detail.deleteTitle": "Supprimer le produit",
  "commerce.admin.detail.deleteConfirm":
    "Supprimer définitivement « $1 » ? Cette action est irréversible.",
  "commerce.admin.detail.deleteCta": "Supprimer",
  "commerce.admin.detail.deleted": "Produit supprimé.",
  "commerce.admin.detail.deleteError": "Impossible de supprimer ce produit",

  "commerce.admin.media.title": "Images",
  "commerce.admin.media.hint":
    "La première image est celle que la boutique affiche dans les listes. Utilisez les flèches pour changer l'ordre.",
  "commerce.admin.media.upload": "Ajouter des images",
  "commerce.admin.media.listing": "Vitrine",
  "commerce.admin.media.moveEarlier": "Déplacer avant",
  "commerce.admin.media.moveLater": "Déplacer après",
  "commerce.admin.media.empty": "Ce produit n'a pas encore d'image.",
  "commerce.admin.media.saved": "Images enregistrées.",

  "commerce.admin.details.attributesTitle": "Caractéristiques",
  "commerce.admin.details.attributesHint":
    "Informations descriptives affichées par la boutique, comme la matière ou les dimensions. Elles n'entrent dans aucun calcul.",
  "commerce.admin.details.attributesEmpty": "Aucune caractéristique.",
  "commerce.admin.details.attributesSaved": "Caractéristiques enregistrées.",
  "commerce.admin.details.attrName": "Nom",
  "commerce.admin.details.attrValue": "Valeur",
  "commerce.admin.details.attrAdd": "Ajouter",
  "commerce.admin.details.attrRemove": "Retirer cette caractéristique",
  "commerce.admin.details.configTitle": "Configuration du type",
  "commerce.admin.details.configHint":
    "Réglages exigés par le type « $1 ». Validés à l'enregistrement.",
  "commerce.admin.details.configSaved": "Configuration enregistrée.",

  "commerce.admin.stock.adjustTitle": "Corriger le stock",
  "commerce.admin.stock.adjustHint":
    "Enregistre un mouvement dans l'historique ci-dessous. Utilisez une quantité négative avec « Correction » pour sortir du stock.",
  "commerce.admin.stock.adjustCta": "Enregistrer",
  "commerce.admin.stock.adjusted": "Stock mis à jour.",
  "commerce.admin.stock.ledgerTitle": "Historique des mouvements",
  "commerce.admin.stock.ledgerEmpty": "Aucun mouvement enregistré.",
  "commerce.admin.stock.colWhen": "Date",
  "commerce.admin.stock.colDelta": "Variation",
  "commerce.admin.stock.colReason": "Motif",
  "commerce.admin.stock.colNote": "Note",
  "commerce.admin.stock.reasonIntake": "Entrée",
  "commerce.admin.stock.reasonSale": "Vente",
  "commerce.admin.stock.reasonReturn": "Retour",
  "commerce.admin.stock.reasonAdjustment": "Correction",
  "commerce.admin.stock.fQuantity": "Quantité",
  "commerce.admin.stock.fReason": "Motif",
  "commerce.admin.stock.fNote": "Note",

  "commerce.admin.orders.empty": "Ce produit n'a jamais été commandé.",
  "commerce.admin.orders.colWhen": "Date",
  "commerce.admin.orders.colOrder": "Commande",
  "commerce.admin.orders.colStatus": "Statut",
  "commerce.admin.orders.colQuantity": "Qté",
  "commerce.admin.orders.colUnitPrice": "Prix unitaire",
  "commerce.admin.orders.colTotal": "Total",
  "commerce.checkout.pay": "Payer",
  "commerce.checkout.declined": "Le paiement a été refusé.",
  "commerce.checkout.paymentSent": "Paiement envoyé…",
};

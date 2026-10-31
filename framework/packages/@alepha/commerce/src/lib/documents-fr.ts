/**
 * What `@alepha/commerce` writes to a customer, in French: invoices, credit
 * notes and emails. Read on the server through `CommerceTexts`, and apart from
 * the back-office catalogues in `i18n-fr.ts`, which React reads.
 *
 * `$1` is a placeholder. Keep this file and `documents-en.ts` key for key: a
 * spec holds them to it.
 */
export const commerceDocumentsFr: Record<string, string> = {
  "invoice.lang": "fr",
  "invoice.decimalMark": ",",
  "invoice.title": "Facture",
  "invoice.creditTitle": "Facture d'avoir",
  "invoice.issuedOn": "Émise le $1",
  "invoice.replaces": "Annule et remplace la facture précédente",
  "invoice.registration": "SIRET",
  "invoice.vat": "TVA",
  "invoice.buyer": "Client",
  "invoice.colDescription": "Désignation",
  "invoice.colQuantity": "Qté",
  "invoice.colUnitPrice": "P.U. TTC",
  "invoice.colTotal": "Total TTC",
  "invoice.total": "Total",
  "invoice.totalNet": "Total HT",
  "invoice.vatLine": "TVA $1 sur $2",
  "invoice.totalGross": "Total TTC",
  "invoice.discount": "Remise",
  "invoice.delivery": "Livraison",
  "invoice.anonymousBuyer": "Client",
  "invoice.paid": "Facture acquittée. Le paiement a été reçu à la commande.",
  "invoice.withdrawal":
    "Conformément aux articles L221-18 et suivants du code de la consommation, vous disposez d'un délai de quatorze jours à compter de la réception pour exercer votre droit de rétractation.",
  "invoice.reverseCharge": "Autoliquidation - article 283-2 du CGI",
  "credit.fullReason": "Remboursement de la commande",
  "credit.partialReason": "Remboursement partiel",

  "mail.confirmation.subject": "Votre commande$1 est confirmée",
  "mail.confirmation.thanks":
    "Merci, nous avons bien reçu votre commande$1 et votre paiement.",
  "mail.confirmation.discount": "Remise déduite : $1",
  "mail.confirmation.delivery": "Livraison : $1",
  "mail.confirmation.total": "Total réglé : $1",
  "mail.confirmation.downloads": "Vos téléchargements :",
  "mail.confirmation.next":
    "Vous recevrez un second message dès que votre colis partira.",
  "mail.confirmation.withdrawal":
    "Vous disposez de quatorze jours à compter de la réception pour exercer votre droit de rétractation, sans avoir à motiver votre décision.",
  "mail.shipped.subject": "Votre commande$1 est en route",
  "mail.shipped.body": "Votre colis a été confié au transporteur.",
  "mail.shipped.tracking": "Numéro de suivi : $1",
  "mail.shipped.follow": "Suivre mon colis",

  "reminder.first.subject": "Votre panier vous attend",
  "reminder.first.body":
    "Vous avez laissé ces articles dans votre panier :\n\n$1\n\nIls sont toujours disponibles - finalisez votre commande quand vous voulez.",
  "reminder.second.subject": "Dernier rappel - votre panier expire bientôt",
  "reminder.second.body":
    "Votre panier contient encore :\n\n$1\n\nIl expirera prochainement. C'est le moment de finaliser votre commande.",
  "reminder.unsubscribe": "Pour ne plus recevoir ces rappels : $1",
};

/**
 * What `@alepha/commerce` writes to a customer, in English. See
 * `documents-fr.ts`.
 *
 * The fallback for any locale nobody supplied, and for any key a partial
 * dictionary left out.
 */
export const commerceDocumentsEn: Record<string, string> = {
  "invoice.lang": "en",
  "invoice.decimalMark": ".",
  "invoice.title": "Invoice",
  "invoice.creditTitle": "Credit note",
  "invoice.issuedOn": "Issued on $1",
  "invoice.replaces": "Cancels and replaces the previous invoice",
  "invoice.registration": "Company no.",
  "invoice.vat": "VAT",
  "invoice.buyer": "Customer",
  "invoice.colDescription": "Description",
  "invoice.colQuantity": "Qty",
  "invoice.colUnitPrice": "Unit price incl. VAT",
  "invoice.colTotal": "Total incl. VAT",
  "invoice.total": "Total",
  "invoice.totalNet": "Total excl. VAT",
  "invoice.vatLine": "VAT $1 on $2",
  "invoice.totalGross": "Total incl. VAT",
  "invoice.discount": "Discount",
  "invoice.delivery": "Delivery",
  "invoice.anonymousBuyer": "Customer",
  "invoice.paid": "Invoice paid. Payment was received with the order.",
  "invoice.withdrawal":
    "You have fourteen days from receipt to exercise your right of withdrawal.",
  "invoice.reverseCharge":
    "Reverse charge: VAT to be accounted for by the buyer",
  "credit.fullReason": "Order refund",
  "credit.partialReason": "Partial refund",

  "mail.confirmation.subject": "Your order$1 is confirmed",
  "mail.confirmation.thanks":
    "Thank you, we have received your order$1 and your payment.",
  "mail.confirmation.discount": "Discount: $1",
  "mail.confirmation.delivery": "Delivery: $1",
  "mail.confirmation.total": "Total paid: $1",
  "mail.confirmation.downloads": "Your downloads:",
  "mail.confirmation.next":
    "You will receive a second message as soon as your parcel leaves.",
  "mail.confirmation.withdrawal":
    "You have fourteen days from receipt to exercise your right of withdrawal, without giving a reason.",
  "mail.shipped.subject": "Your order$1 is on its way",
  "mail.shipped.body": "Your parcel has been handed to the carrier.",
  "mail.shipped.tracking": "Tracking number: $1",
  "mail.shipped.follow": "Track my parcel",

  "reminder.first.subject": "Your basket is waiting",
  "reminder.first.body":
    "You left these items in your basket:\n\n$1\n\nThey are still available: complete your order whenever you like.",
  "reminder.second.subject": "Last reminder: your basket expires soon",
  "reminder.second.body":
    "Your basket still holds:\n\n$1\n\nIt will expire soon. Now is the time to complete your order.",
  "reminder.unsubscribe": "To stop receiving these reminders: $1",
};

import { commerceEn } from "@alepha/commerce/lib/i18n-en";
import { commerceFr } from "@alepha/commerce/lib/i18n-fr";
import { uiFr } from "@alepha/ui/lib/i18n-fr";
import { $dictionary } from "alepha/react/i18n";

/**
 * The shop's interface, in French and English.
 *
 * French is the atelier's own language and reads as the original; the English is
 * a translation, written to be plain rather than clever: "Add to basket", not
 * "Make it yours".
 *
 * ### What is *not* translated, and why it matters
 *
 * Product names, descriptions and spec copy live in the database as single-language
 * text, so a visitor reading English still sees "Collier Aurore · Argent · 4,2 g".
 * That is a real limitation rather than an oversight: localising catalogue copy
 * needs either per-locale columns or a translations table keyed by product and
 * locale, and inventing one for a demo would hide the decision. A shop selling
 * across the EU has to make it before its second market.
 *
 * Keys are grouped by screen so a missing one is obvious in a diff.
 */
export class ShopI18n {
  fr = $dictionary({
    lazy: async () => ({
      default: {
        /*
         * `@alepha/ui`'s own French strings: dialogs, tables, the auth screens.
         *
         * Spread first so anything the shop redefines below wins. Without it the
         * confirmation dialogs said "Cancel / Confirm" and the back-office table
         * announced "Open row actions" on an otherwise French site: those
         * components call `tr()` but default to English, so an undefined key is
         * indistinguishable from a deliberate one.
         *
         * ⚠️ **This has a mirror-image bug that is still open.** `tr()` falls
         * back to `fallbackLang` (French here) before it reaches a
         * component's `default:`, so all 454 keys below now resolve to FRENCH
         * for an English visitor. `/admin/jobs` in English shows a column
         * headed "Nom". `@alepha/ui` ships no `uiEn` to spread into the English
         * dictionary the way `commerceEn` is spread, so there is nothing to fix
         * it with from here; it needs the twin catalogue upstream.
         */
        ...uiFr,

        /*
         * `@alepha/commerce`'s back office, same arrangement and same reason:
         * those components default to English too, so without this the three
         * `/admin` commerce screens are English on an otherwise French site.
         *
         * Spread before the shop's own keys, which is what lets the overrides
         * below rename "produit" to the atelier's "pièce".
         */
        ...commerceFr,

        "language.fr": "Français",
        "language.en": "English",

        // Shell
        "nav.produits": "Produits",
        "nav.atelier": "L'atelier",
        "nav.panier": "Panier",
        "nav.home": "Atelier Aurore, accueil",
        "nav.cartCount": "$1 article(s)",
        // Passed to `ButtonUser`, whose own defaults are English.
        "nav.signIn": "Se connecter",
        "nav.account": "Mon compte",
        "footer.legal":
          "Atelier Aurore · 12 rue des Orfèvres, Paris · SIRET 912 345 678 00012",
        "footer.demo":
          "Boutique de démonstration. Aucune commande n'est réellement fabriquée.",

        // Home
        "home.eyebrow": "Atelier de bijouterie · Paris 1er · depuis 2019",
        "home.title1": "Dessiné",
        "home.title2": "avant",
        "home.title3": "d'exister",
        "home.lede":
          "Chaque pièce commence par un tracé au crayon, puis une cire, puis une fonte. Nous en faisons deux ou trois à la fois. Ce que vous voyez ici, ce sont les dessins.",
        "home.cta": "Voir la pièce",
        "home.count": "Les pièces · $1",

        // Piece
        "produit.add": "Ajouter au panier",
        "produit.adding": "Ajout…",
        "produit.soldOut": "Épuisée",
        "produit.added": "$1 est dans votre panier.",
        "produit.addFailedStock":
          "Cette pièce vient de partir. Écrivez-nous, nous en refaisons.",
        "produit.addFailed": "Impossible d'ajouter cette pièce pour le moment.",
        "produit.instant": "Envoi immédiat par courriel",
        "produit.engraved": "Gravé après commande",
        "produit.noneLeft": "Aucune en atelier",
        "produit.inStock": "$1 en atelier",
        "produit.restockNote":
          "Nous en refaisons régulièrement. Écrivez à contact@atelier-aurore.test et nous vous prévenons.",
        "produit.viewCart": "Voir le panier",

        // Spec plate
        "spec.metal": "Métal",
        "spec.titre": "Titre",
        "spec.poids": "Poids",
        "spec.dimensions": "Dimensions",
        "spec.reference": "Référence",

        // Cart
        "cart.title": "Panier",
        "cart.empty": "Panier vide",
        "cart.emptyLede": "Six pièces vous attendent à l'atelier.",
        "cart.emptyCta": "Voir les pièces",
        "cart.quantity": "Quantité",
        "cart.quantityFor": "Quantité pour $1",
        "piece.drawingAlt": "$1, dessin d'atelier",
        "hallmark.fineness": "Titre $1 millièmes",
        "hallmark.mark": "Poinçon $1",
        "cart.remove": "Retirer",
        "cart.subtotal": "Sous-total",
        "cart.shippingLater": "Livraison calculée à l'étape suivante",
        "cart.checkout": "Commander",

        // Checkout
        "checkout.title": "Commande",
        "checkout.step1": "Adresse",
        "checkout.step2": "Livraison",
        "checkout.step3": "Paiement",
        "checkout.addressTitle": "Où livrons-nous ?",
        "checkout.continue": "Continuer",
        "checkout.back": "Retour",
        "checkout.shippingTitle": "Comment livrons-nous ?",
        "checkout.noShipping":
          "Rien à expédier : votre commande est dématérialisée.",
        "checkout.oneDay": "$1 jour ouvré",
        "checkout.days": "$1 à $2 jours ouvrés",
        "checkout.free": "Offerte",
        "checkout.payTitle": "Paiement",
        "checkout.payLede":
          "Vous allez régler sur la page sécurisée de notre prestataire, puis revenir ici. Nous ne voyons jamais votre numéro de carte.",
        "checkout.payDemo": "Boutique de démonstration · aucun paiement réel",
        "checkout.pay": "Payer",
        "checkout.redirecting": "Redirection…",
        "checkout.payFailed": "Le paiement n'a pas pu démarrer.",
        "checkout.addressFailed": "L'adresse n'a pas pu être enregistrée.",
        "checkout.embedded":
          "Paiement embarqué : à monter avec le fournisseur configuré.",
        "checkout.summary": "Récapitulatif",
        "checkout.shipping": "Livraison",
        "checkout.total": "Total",
        "checkout.vat": "dont TVA 20 %",
        "checkout.emptyCart": "Panier vide",
        "checkout.emptyCartLede": "Ajoutez une pièce avant de commander.",

        // Field labels, used by the generated address form
        "field.email": "Courriel",
        "field.emailHint": "Pour la confirmation et le suivi.",
        "field.fullName": "Nom complet",
        "field.line1": "Adresse",
        "field.line2": "Complément",
        "field.postalCode": "Code postal",
        "field.locality": "Ville",
        "field.country": "Pays",

        // Confirmation
        "thanks.pending": "Paiement en cours",
        "thanks.title": "Merci",
        "thanks.order": "Commande $1",
        "thanks.pendingLede":
          "Nous attendons la confirmation de votre banque. Cette page se mettra à jour ; vous recevrez aussi un courriel.",
        "thanks.paidLede":
          "Votre commande est enregistrée et payée. Un courriel de confirmation part à l'instant, et un second quand le colis sera confié au transporteur.",
        "thanks.shipping": "Livraison",
        "thanks.total": "Total réglé",
        "thanks.vat": "dont TVA",
        "thanks.invoice": "Facture $1",
        "thanks.invoiceSoon":
          "La facture s'affichera ici dans quelques secondes.",
        "thanks.withdrawal":
          "Vous disposez de quatorze jours à compter de la réception pour changer d'avis, sans avoir à vous justifier.",
        "thanks.back": "← Retour à l'atelier",

        // Atelier
        "atelier.title": "L'atelier",
        "atelier.lede":
          "Douze mètres carrés au premier étage, rue des Orfèvres. Un établi, une plaque à dégrossir, un laminoir de 1962 racheté à un atelier de la rue du Temple qui fermait. On y fait deux ou trois pièces à la fois, ce qui est peu et voulu.",
        "atelier.marksTitle": "Les poinçons",
        "atelier.gold": "Or 18 carats",
        "atelier.goldSub": "750 millièmes d'or fin",
        "atelier.silver": "Argent sterling",
        "atelier.silverSub": "925 millièmes d'argent fin",
        "atelier.marksLede":
          "Chaque pièce est frappée à l'intérieur : le titre du métal, puis notre losange. C'est cette marque que vous voyez partout sur ce site : elle dit de quoi la pièce est faite, rien d'autre.",
        "atelier.drawingsTitle": "Les dessins",
        "atelier.drawingsLede":
          "Les images du catalogue sont les dessins d'atelier, pas des photographies. C'est sous cette forme que la pièce existe d'abord : un tracé coté, une cire, une fonte, puis la lime et le poli. Nous préférons vous montrer l'intention que la lumière d'un studio.",
        "atelier.repairsTitle": "Reprises et réparations",
        "atelier.repairsLede":
          "Une bague se remet à la taille, un fermoir se remplace, un poli se refait. Écrivez à contact@atelier-aurore.test avec la référence gravée à l'intérieur ; nous reprenons nos pièces sans limite de date.",
        "atelier.demo":
          "Cette boutique est une démonstration technique. L'atelier, le laminoir de 1962 et les pièces sont inventés.",

        // Admin shell
        "admin.brand": "Atelier · gestion",
        "admin.produits": "Produits",
        "admin.orders": "Commandes",
        "admin.shipping": "Livraison",
      },
    }),
  });

  en = $dictionary({
    lazy: async () => ({
      default: {
        /*
         * The English half of the commerce pair.
         *
         * Not optional even though the components already default to English:
         * `tr()` tries this dictionary, then `fallbackLang` (`fr`), and only
         * then the component's `default:`. Without it, every key `commerceFr`
         * defines resolves to French here, which is exactly how the English
         * back office ended up with a French table.
         *
         * The same trap still applies to `uiFr`, which has no English twin:
         * see the note above it in the `fr` block.
         */
        ...commerceEn,

        "language.fr": "Français",
        "language.en": "English",

        "nav.produits": "Products",
        "nav.atelier": "The workshop",
        "nav.panier": "Basket",
        "nav.home": "Atelier Aurore, home",
        "nav.cartCount": "$1 item(s)",
        "nav.signIn": "Sign in",
        "nav.account": "My account",
        "footer.legal":
          "Atelier Aurore · 12 rue des Orfèvres, Paris · SIRET 912 345 678 00012",
        "footer.demo": "Demonstration shop. No order is actually made.",

        "home.eyebrow": "Goldsmith's workshop · Paris 1st · since 2019",
        "home.title1": "Drawn",
        "home.title2": "before",
        "home.title3": "it exists",
        "home.lede":
          "Every piece starts as a pencil line, then a wax, then a casting. We make two or three at a time. What you see here are the drawings.",
        "home.cta": "See the piece",
        "home.count": "The pieces · $1",

        "produit.add": "Add to basket",
        "produit.adding": "Adding…",
        "produit.soldOut": "Sold out",
        "produit.added": "$1 is in your basket.",
        "produit.addFailedStock":
          "That one has just gone. Write to us, we make them again.",
        "produit.addFailed": "This piece cannot be added right now.",
        "produit.instant": "Sent by email immediately",
        "produit.engraved": "Engraved to order",
        "produit.noneLeft": "None in the workshop",
        "produit.inStock": "$1 in the workshop",
        "produit.restockNote":
          "We make these regularly. Write to contact@atelier-aurore.test and we will let you know.",
        "produit.viewCart": "View basket",

        "spec.metal": "Metal",
        "spec.titre": "Fineness",
        "spec.poids": "Weight",
        "spec.dimensions": "Dimensions",
        "spec.reference": "Reference",

        "cart.title": "Basket",
        "cart.empty": "Your basket is empty",
        "cart.emptyLede": "Six pieces are waiting in the workshop.",
        "cart.emptyCta": "See the pieces",
        "cart.quantity": "Quantity",
        "cart.quantityFor": "Quantity for $1",
        "piece.drawingAlt": "$1, workshop drawing",
        "hallmark.fineness": "Fineness $1 thousandths",
        "hallmark.mark": "Hallmark $1",
        "cart.remove": "Remove",
        "cart.subtotal": "Subtotal",
        "cart.shippingLater": "Delivery calculated at the next step",
        "cart.checkout": "Checkout",

        "checkout.title": "Checkout",
        "checkout.step1": "Address",
        "checkout.step2": "Delivery",
        "checkout.step3": "Payment",
        "checkout.addressTitle": "Where are we sending it?",
        "checkout.continue": "Continue",
        "checkout.back": "Back",
        "checkout.shippingTitle": "How are we sending it?",
        "checkout.noShipping": "Nothing to ship: your order is digital.",
        "checkout.oneDay": "$1 working day",
        "checkout.days": "$1 to $2 working days",
        "checkout.free": "Free",
        "checkout.payTitle": "Payment",
        "checkout.payLede":
          "You will pay on our provider's secure page, then come back here. We never see your card number.",
        "checkout.payDemo": "Demonstration shop · no real payment",
        "checkout.pay": "Pay",
        "checkout.redirecting": "Redirecting…",
        "checkout.payFailed": "The payment could not be started.",
        "checkout.addressFailed": "The address could not be saved.",
        "checkout.embedded":
          "Embedded payment: mount it with the configured provider.",
        "checkout.summary": "Summary",
        "checkout.shipping": "Delivery",
        "checkout.total": "Total",
        "checkout.vat": "including 20% VAT",
        "checkout.emptyCart": "Your basket is empty",
        "checkout.emptyCartLede": "Add a piece before checking out.",

        "field.email": "Email",
        "field.emailHint": "For your confirmation and tracking.",
        "field.fullName": "Full name",
        "field.line1": "Address",
        "field.line2": "Apartment, floor, etc.",
        "field.postalCode": "Postcode",
        "field.locality": "Town",
        "field.country": "Country",

        "thanks.pending": "Payment in progress",
        "thanks.title": "Thank you",
        "thanks.order": "Order $1",
        "thanks.pendingLede":
          "We are waiting for your bank to confirm. This page will update, and you will get an email too.",
        "thanks.paidLede":
          "Your order is recorded and paid. A confirmation email is on its way, and a second one when the parcel is handed to the carrier.",
        "thanks.shipping": "Delivery",
        "thanks.total": "Total paid",
        "thanks.vat": "including VAT",
        "thanks.invoice": "Invoice $1",
        "thanks.invoiceSoon": "Your invoice will appear here in a few seconds.",
        "thanks.withdrawal":
          "You have fourteen days from delivery to change your mind, with no reason required.",
        "thanks.back": "← Back to the workshop",

        "atelier.title": "The workshop",
        "atelier.lede":
          "Twelve square metres on the first floor, rue des Orfèvres. A bench, a swage block, and a 1962 rolling mill bought from a workshop on rue du Temple that was closing. We make two or three pieces at a time, which is few, and deliberate.",
        "atelier.marksTitle": "The hallmarks",
        "atelier.gold": "18-carat gold",
        "atelier.goldSub": "750 parts per thousand fine gold",
        "atelier.silver": "Sterling silver",
        "atelier.silverSub": "925 parts per thousand fine silver",
        "atelier.marksLede":
          "Every piece is struck on the inside: the metal's fineness, then our lozenge. That mark is what you see all over this site: it says what the piece is made of, and nothing else.",
        "atelier.drawingsTitle": "The drawings",
        "atelier.drawingsLede":
          "The catalogue images are workshop drawings, not photographs. That is the form a piece exists in first: a dimensioned line, a wax, a casting, then the file and the polish. We would rather show you the intent than a studio light.",
        "atelier.repairsTitle": "Resizing and repairs",
        "atelier.repairsLede":
          "A ring can be resized, a clasp replaced, a polish redone. Write to contact@atelier-aurore.test with the reference engraved inside; we take our pieces back with no time limit.",
        "atelier.demo":
          "This shop is a technical demonstration. The workshop, the 1962 rolling mill and the pieces are invented.",

        "admin.brand": "Workshop · admin",
        "admin.produits": "Products",
        "admin.orders": "Orders",
        "admin.shipping": "Delivery",
      },
    }),
  });
}

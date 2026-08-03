export interface PrixProps {
  /** Tax-inclusive amount in the smallest currency unit. */
  cents: number;
  currency?: string;
  className?: string;
  /** Struck through, for a shipping rate the cart has made free. */
  barre?: boolean;
}

/**
 * A price.
 *
 * One component so that every amount on the site is formatted identically — a
 * shop where the cart says `89,00 €` and the invoice says `89.00 EUR` reads as
 * two shops. French locale, because the atelier is in Paris and prices are
 * tax-inclusive by law for consumers.
 */
export const Prix = (props: PrixProps) => {
  const { cents, currency = "EUR", className, barre } = props;

  const formatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    // Whole euros are common at these prices; showing `,00` on every one is noise.
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

  return (
    <span
      className={`prix ${barre ? "text-muted-foreground line-through" : ""} ${
        className ?? ""
      }`}
    >
      {formatted}
    </span>
  );
};

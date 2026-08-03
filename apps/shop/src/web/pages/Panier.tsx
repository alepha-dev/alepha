import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useEffect } from "react";
import { Dessin } from "../components/Dessin.tsx";
import { Prix } from "../components/Prix.tsx";
import { usePanier } from "../hooks/usePanier.ts";

/**
 * The cart.
 *
 * Quantities are edited in place and every change round-trips to the server,
 * which returns the whole repriced cart. Slower than optimistic updates by a few
 * hundred milliseconds, and worth it: the number on screen is always the number
 * the server will charge.
 */
const Panier = () => {
  const { panier, refresh, definirQuantite, retirer } = usePanier();
  const { tr } = useI18n();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (panier.lines.length === 0) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-24 text-center">
        <h1 className="estampe-lg">{tr("cart.empty")}</h1>
        {/* An empty screen is an invitation to act, not a dead end. */}
        <p className="text-muted-foreground mt-4">{tr("cart.emptyLede")}</p>
        <Link
          href="/"
          className="estampe border-foreground hover:bg-foreground hover:text-background mt-8 inline-block border px-6 py-3 text-xs transition-colors"
        >
          {tr("cart.emptyCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-12 md:py-20">
      <h1 className="estampe-lg">{tr("cart.title")}</h1>

      <ul className="mt-10">
        {panier.lines.map((line) => (
          <li key={line.productId} className="trait border-t first:border-t-0">
            <div className="grid grid-cols-[4rem_1fr_auto] items-center gap-5 py-5">
              <Dessin image={line.image} nom={line.name} />

              <div className="min-w-0">
                <h2 className="estampe text-sm">{line.name}</h2>
                <div className="mesure text-muted-foreground mt-2 flex items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span>{tr("cart.quantity")}</span>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={line.quantity}
                      onChange={(event) =>
                        void definirQuantite(
                          line.productId,
                          Number(event.target.value),
                        )
                      }
                      className="border-input bg-background w-14 border px-2 py-1 text-center"
                      aria-label={tr("cart.quantityFor", { args: [line.name] })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void retirer(line.productId)}
                    className="hover:text-destructive underline transition-colors"
                  >
                    {tr("cart.remove")}
                  </button>
                </div>
              </div>

              <Prix cents={line.lineTotal} currency={panier.currency} />
            </div>
          </li>
        ))}
      </ul>

      <div className="trait mt-2 flex items-baseline justify-between border-t pt-6">
        <span className="estampe text-sm">{tr("cart.subtotal")}</span>
        <Prix
          cents={panier.subtotal}
          currency={panier.currency}
          className="text-xl"
        />
      </div>
      <p className="mesure text-muted-foreground mt-2 text-right">
        {tr("cart.shippingLater")}
      </p>

      <Link
        href="/commande"
        className="estampe bg-primary text-primary-foreground hover:bg-primary/90 mt-8 flex h-12 w-full items-center justify-center text-xs transition-colors"
      >
        {tr("cart.checkout")}
      </Link>
    </section>
  );
};

export default Panier;

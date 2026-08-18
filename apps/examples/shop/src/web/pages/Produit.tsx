import type { PublicProduct } from "@alepha/commerce";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";
import { Dessin } from "../components/Dessin.tsx";
import { PlaqueSpec } from "../components/PlaqueSpec.tsx";
import { Poincon } from "../components/Poincon.tsx";
import { Prix } from "../components/Prix.tsx";
import { usePanier } from "../hooks/usePanier.ts";

export interface ProduitProps {
  produit: PublicProduct;
  /** What may still be sold — on-hand minus what other carts are holding. */
  disponible: number;
}

/**
 * One produit.
 *
 * The drawing gets the larger half and the facts get the smaller one, which is
 * the reverse of a usual product page where copy dominates. For an object sold on
 * its material and its making, the measurements *are* the argument.
 */
const Produit = (props: ProduitProps) => {
  const { produit, disponible } = props;
  const spec = (produit.attributes ?? {}) as Record<string, string>;
  const { ajouter } = usePanier();
  const toast = useToast();
  const { tr } = useI18n();
  const [ajoutEnCours, setAjoutEnCours] = useState(false);

  const surCommande = produit.kind === "engraved";
  const dematerialise = produit.kind === "digital";
  const epuise = !dematerialise && disponible <= 0;

  const onAjouter = async () => {
    setAjoutEnCours(true);
    try {
      await ajouter(produit.id);
      toast.success(tr("produit.added", { args: [produit.name] }));
    } catch (error) {
      // The domain answers 409 when the last one has just gone. Say that,
      // not "something went wrong".
      toast.error(
        error instanceof Error && /stock/i.test(error.message)
          ? tr("produit.addFailedStock")
          : tr("produit.addFailed"),
      );
    } finally {
      setAjoutEnCours(false);
    }
  };

  return (
    <article className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-12 md:grid-cols-[1fr_22rem] md:py-20">
      <div className="pose relative">
        <Dessin
          image={produit.images[0]}
          nom={produit.name}
          priority
          className="mx-auto max-w-[28rem]"
        />
        <div className="absolute top-0 right-0">
          <Poincon
            titre={String(spec.titre ?? "—")}
            size="lg"
            className="text-muted-foreground"
          />
        </div>
      </div>

      <div className="pose" style={{ animationDelay: "120ms" }}>
        <h1 className="estampe-lg">{produit.name}</h1>

        <div className="mt-6">
          <Prix
            cents={produit.price}
            currency={produit.currency}
            className="text-2xl"
          />
        </div>

        <p className="text-muted-foreground mt-6">{produit.description}</p>

        <PlaqueSpec spec={spec} reference={produit.slug} variant="detail" />

        {/*
          Availability, stated as a fact rather than as urgency. "Plus que 2 !"
          is a pressure tactic; "deux en atelier" is what is true.
        */}
        <p className="mesure text-muted-foreground mt-6">
          {dematerialise
            ? tr("produit.instant")
            : surCommande
              ? `${tr("produit.engraved")}${spec.dimensions ? ` · ${spec.dimensions}` : ""}`
              : epuise
                ? tr("produit.noneLeft")
                : tr("produit.inStock", { args: [String(disponible)] })}
        </p>

        <Button
          className="estampe mt-8 h-12 w-full text-xs"
          onClick={onAjouter}
          disabled={epuise || ajoutEnCours}
        >
          {epuise
            ? tr("produit.soldOut")
            : ajoutEnCours
              ? tr("produit.adding")
              : tr("produit.add")}
        </Button>

        {epuise ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {tr("produit.restockNote")}
          </p>
        ) : (
          <Link
            href="/panier"
            className="mesure text-muted-foreground hover:text-foreground mt-3 block w-full text-center transition-colors"
          >
            {tr("produit.viewCart")}
          </Link>
        )}
      </div>
    </article>
  );
};

export default Produit;

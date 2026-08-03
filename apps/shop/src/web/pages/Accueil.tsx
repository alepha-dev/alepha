import type { PublicProduct } from "@alepha/commerce";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Dessin } from "../components/Dessin.tsx";
import { PlaqueSpec } from "../components/PlaqueSpec.tsx";
import { Poincon } from "../components/Poincon.tsx";
import { Prix } from "../components/Prix.tsx";

export interface AccueilProps {
  pieces: PublicProduct[];
  /** The piece that opens the page, chosen by the atelier rather than by sort. */
  hero?: PublicProduct;
}

/**
 * The catalogue.
 *
 * Structured as a list, not a grid. A grid says "there is more where this came
 * from"; this atelier has six pieces and each is made in ones and twos, so the
 * honest layout gives every piece a full row and lets the page be short. The
 * drawings alternate side so the eye moves down the page rather than scanning
 * columns.
 */
const Accueil = (props: AccueilProps) => {
  const { pieces, hero } = props;
  const { tr } = useI18n();
  const first = hero ?? pieces[0];

  return (
    <div>
      {/*
        The hero is one piece, drawn, at the size a jeweller would draw it — the
        most characteristic thing in this world is the drawing that precedes the
        object, so that is what opens the page. No stock photograph, no stat.
      */}
      {first ? (
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
          <div className="pose" style={{ animationDelay: "80ms" }}>
            <p className="mesure text-muted-foreground mb-6">
              {tr("home.eyebrow")}
            </p>
            <h1 className="estampe-xl max-w-[18ch]">
              {tr("home.title1")}
              <br />
              {tr("home.title2")}
              <br />
              {tr("home.title3")}
            </h1>
            <p className="text-muted-foreground mt-8 max-w-[46ch]">
              {tr("home.lede")}
            </p>
            <Link
              href={`/piece/${first.slug}`}
              className="estampe border-foreground hover:bg-foreground hover:text-background mt-10 inline-block border px-6 py-3 text-xs transition-colors"
            >
              {tr("home.cta")}
            </Link>
          </div>

          <div className="pose relative" style={{ animationDelay: "180ms" }}>
            <Dessin
              image={first.images[0]}
              nom={first.name}
              priority
              className="mx-auto max-w-[22rem]"
            />
            <div className="absolute right-0 bottom-0">
              <Poincon
                titre={String((first.attributes as any)?.titre ?? "—")}
                size="lg"
                className="text-muted-foreground"
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-6xl px-5 pb-16">
        <h2 className="estampe trait text-muted-foreground border-t pt-4 text-xs">
          {tr("home.count", { args: [String(pieces.length)] })}
        </h2>

        <ul>
          {pieces.map((piece, index) => {
            const spec = (piece.attributes ?? {}) as Record<string, string>;
            return (
              <li
                key={piece.id}
                className="pose trait border-t first:border-t-0"
                style={{ animationDelay: `${120 + index * 70}ms` }}
              >
                <Link
                  href={`/piece/${piece.slug}`}
                  className="group grid grid-cols-[5rem_1fr] items-center gap-5 py-6 sm:grid-cols-[7rem_1fr_auto] sm:gap-8"
                >
                  <Dessin
                    image={piece.images[0]}
                    nom={piece.name}
                    className="opacity-90 transition-opacity group-hover:opacity-100"
                  />

                  <div className="min-w-0">
                    <h3 className="estampe-lg group-hover:text-primary transition-colors">
                      {piece.name}
                    </h3>
                    <div className="mt-2">
                      <PlaqueSpec spec={spec} reference={piece.slug} />
                    </div>
                    <p className="text-muted-foreground mt-3 line-clamp-2 max-w-[60ch] text-sm sm:line-clamp-1">
                      {piece.description}
                    </p>
                  </div>

                  <Prix
                    cents={piece.price}
                    currency={piece.currency}
                    className="col-span-2 text-lg sm:col-span-1 sm:text-xl"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

export default Accueil;

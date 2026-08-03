import { useI18n } from "alepha/react/i18n";
import { Poincon } from "../components/Poincon.tsx";

/**
 * The workshop page.
 *
 * Exists because a shop selling €690 rings has to say who made them, and because
 * the hallmark that appears on every piece needs somewhere it is explained. Three
 * short sections, no team photos, no "our story" — a workshop describing its own
 * work.
 */
const Atelier = () => {
  const { tr } = useI18n();

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16 md:py-24">
      <h1 className="estampe-xl">{tr("atelier.title")}</h1>

      <p className="text-muted-foreground mt-10 text-base">
        {tr("atelier.lede")}
      </p>

      <section className="trait mt-14 border-t pt-8">
        <h2 className="estampe text-xs">{tr("atelier.marksTitle")}</h2>
        <div className="mt-6 flex flex-wrap items-center gap-8">
          <div className="flex items-center gap-4">
            <Poincon titre="750" size="lg" className="text-or-jaune" />
            <p className="text-sm">
              <span className="estampe block text-xs">
                {tr("atelier.gold")}
              </span>
              <span className="text-muted-foreground">
                {tr("atelier.goldSub")}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Poincon titre="925" size="lg" className="text-argent" />
            <p className="text-sm">
              <span className="estampe block text-xs">
                {tr("atelier.silver")}
              </span>
              <span className="text-muted-foreground">
                {tr("atelier.silverSub")}
              </span>
            </p>
          </div>
        </div>
        <p className="text-muted-foreground mt-6 text-sm">
          {tr("atelier.marksLede")}
        </p>
      </section>

      <section className="trait mt-10 border-t pt-8">
        <h2 className="estampe text-xs">{tr("atelier.drawingsTitle")}</h2>
        <p className="text-muted-foreground mt-4 text-sm">
          {tr("atelier.drawingsLede")}
        </p>
      </section>

      <section className="trait mt-10 border-t pt-8">
        <h2 className="estampe text-xs">{tr("atelier.repairsTitle")}</h2>
        <p className="text-muted-foreground mt-4 text-sm">
          {tr("atelier.repairsLede")}
        </p>
      </section>

      <p className="mesure text-muted-foreground trait mt-14 border-t pt-6">
        {tr("atelier.demo")}
      </p>
    </div>
  );
};

export default Atelier;

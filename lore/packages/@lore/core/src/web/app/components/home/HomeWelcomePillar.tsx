import HomeWelcomePillarArt, {
  type HomeWelcomePillarArtProps,
} from "./HomeWelcomePillarArt.tsx";

export interface HomeWelcomePillarProps {
  pillar: HomeWelcomePillarArtProps["pillar"];
  title: string;
  description: string;
}

/**
 * One of Lore's three pillars (Plan, Remember, Ship): a cell of the welcome
 * page's ruled band, its line drawing over the words on a soft neutral glow.
 * The cell paints the page background so the dots stop at its rules, as the
 * dashboard's tiles do. On a phone the drawing sits left of the words.
 */
const HomeWelcomePillar = (props: HomeWelcomePillarProps) => {
  return (
    <div className="bg-background relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,var(--muted),transparent_70%)]"
      />
      <div className="relative flex items-center gap-4 p-5 md:flex-col md:items-start md:gap-3 md:p-6">
        <HomeWelcomePillarArt
          pillar={props.pillar}
          className="h-12 w-24 shrink-0 md:h-20 md:w-full"
        />
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold">{props.title}</span>
          <span className="text-muted-foreground text-sm leading-snug">
            {props.description}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HomeWelcomePillar;

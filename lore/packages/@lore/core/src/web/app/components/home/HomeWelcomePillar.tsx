import { ArrowUpRight } from "lucide-react";

export interface HomeWelcomePillarProps {
  /**
   * Which pillar, and so which pair of images: `/images/welcome/<pillar>-light.webp`
   * and `<pillar>-dark.webp`, in `apps/lore/public`.
   */
  pillar: "plan" | "remember" | "build" | "ship";
  title: string;
  description: string;
  /**
   * The guide that opens this pillar's section, on alepha.dev.
   */
  href: string;
}

/**
 * One of Lore's four pillars (Plan, Remember, Build, Ship): a cell of the welcome
 * page's ruled band, an image fading into the card above its words.
 *
 * ## The image is a background, faded on every side
 *
 * It covers the card and is masked twice, intersected: a vertical fade that
 * is gone before the title, so the words always sit on the page background,
 * and a horizontal one, so no edge of the picture meets the cell's rules. At
 * rest it is held back (less in light mode, whose pale pictures would
 * otherwise vanish into the page); hover raises its opacity and grows it slightly,
 * which reads as the picture surfacing. The mask itself never changes on
 * hover: a mask does not transition, so a second one would jump. Opacity and
 * transform only, so the hover stays on the compositor.
 *
 * ## One picture per mode
 *
 * Each pillar has a light and a dark image, painted for their background
 * rather than one inverted into the other, and the `dark:` variant shows one
 * of them. Both are monochrome, so every Lore theme takes them as they are.
 *
 * The whole cell is a link to the pillar's guide, like the feature cells
 * under it (`HomeWelcomeFeature`), and shows the same arrow on hover.
 */
const HomeWelcomePillar = (props: HomeWelcomePillarProps) => {
  const src = (mode: "light" | "dark") =>
    `/images/welcome/${props.pillar}-${mode}.webp`;

  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="bg-background group relative block overflow-hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_15%,transparent_64%),linear-gradient(to_right,transparent,black_15%,black_85%,transparent)] [mask-composite:intersect] opacity-60 transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.03] group-hover:opacity-95 group-focus-visible:opacity-95 dark:opacity-45 dark:group-hover:opacity-90 dark:group-focus-visible:opacity-90"
      >
        <img
          src={src("light")}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top dark:hidden"
        />
        <img
          src={src("dark")}
          alt=""
          loading="lazy"
          decoding="async"
          className="hidden size-full object-cover object-top dark:block"
        />
      </div>
      {/*
        Bottom-aligned while the pillars stack; side by side, the words start
        at one height in every cell, so a shorter description (Ship's) no
        longer drops its title below the others. A longer one grows the row.
      */}
      <div className="relative flex min-h-56 flex-col justify-end gap-1 p-5 md:min-h-72 md:justify-start md:p-6 md:pt-44">
        <span className="flex items-center gap-1 text-base font-semibold">
          {props.title}
          <ArrowUpRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="text-muted-foreground text-sm leading-snug">
          {props.description}
        </span>
      </div>
    </a>
  );
};

export default HomeWelcomePillar;

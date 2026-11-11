export interface HomeWelcomePillarArtProps {
  pillar: "plan" | "remember" | "ship";
  className?: string;
}

/**
 * The line drawing of one pillar, in the hand of the Lore sprite: thin
 * strokes in the text colour, so it follows light and dark. Plan is a path
 * climbing to a summit, Remember an open book whose notes are linked, Ship a
 * comet trail. Dashes drift and stars twinkle, slowly; the keyframes live in
 * `main.css` (`.lore-art-*`) and stop under `prefers-reduced-motion`.
 */
const HomeWelcomePillarArt = (props: HomeWelcomePillarArtProps) => {
  return (
    <svg
      viewBox="0 0 120 64"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lore-art text-foreground ${props.className ?? ""}`}
    >
      {props.pillar === "plan" && (
        <>
          <path
            className="lore-art-drift"
            d="M8 56 C30 56 30 36 52 36 S74 18 96 18"
          />
          <path d="M92 10 L104 18 L92 26" opacity="0.5" />
          <circle cx="8" cy="56" r="3" fill="currentColor" />
          <circle cx="52" cy="36" r="2.5" />
          <circle className="lore-art-twinkle" cx="96" cy="18" r="3.5" />
        </>
      )}
      {props.pillar === "remember" && (
        <>
          <path
            d="M60 14 C48 8 30 8 20 12 L20 56 C30 52 48 52 60 58 C72 52 90 52 100 56 L100 12 C90 8 72 8 60 14 Z"
            opacity="0.5"
          />
          <path d="M60 14 L60 58" opacity="0.5" />
          <path
            className="lore-art-drift"
            d="M34 26 L46 38 M74 24 L86 36 M46 38 L74 24"
          />
          <circle
            className="lore-art-twinkle"
            cx="34"
            cy="26"
            r="2.5"
            fill="currentColor"
          />
          <circle cx="46" cy="38" r="1.8" fill="currentColor" />
          <circle cx="74" cy="24" r="1.8" fill="currentColor" />
          <circle
            className="lore-art-twinkle lore-art-later"
            cx="86"
            cy="36"
            r="2.5"
            fill="currentColor"
          />
        </>
      )}
      {props.pillar === "ship" && (
        <>
          <path className="lore-art-drift" d="M10 58 Q50 54 88 20" />
          <path
            d="M84 14 L98 10 L94 24 Z"
            fill="currentColor"
            fillOpacity="0.15"
          />
          <path
            className="lore-art-twinkle"
            d="M30 18 L31.5 22 L35.5 23.5 L31.5 25 L30 29 L28.5 25 L24.5 23.5 L28.5 22 Z"
            fill="currentColor"
            stroke="none"
          />
          <circle
            className="lore-art-twinkle lore-art-later"
            cx="104"
            cy="44"
            r="1.5"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
};

export default HomeWelcomePillarArt;

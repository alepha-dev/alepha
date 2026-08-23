import { useI18n } from "alepha/react/i18n";

export interface PoinconProps {
  /**
   * What is struck inside the mark — a metal fineness in parts per thousand
   * (`750` for 18-carat gold, `925` for sterling), or the atelier's initials.
   */
  titre: string;
  size?: "sm" | "lg";
  className?: string;
}

/**
 * A French hallmark, struck.
 *
 * This is the shop's signature element, and it earns its place by carrying a
 * fact rather than a decoration: the number inside is the metal's fineness, the
 * same figure a real punch leaves inside a ring. It appears in the header as the
 * atelier's own mark, on every piece, and on the confirmation — always saying the
 * same true thing.
 *
 * ### Drawn as SVG, after a false start
 *
 * The first version was a bordered `<span>` clipped to a lozenge with
 * `clip-path`. It rendered as nothing: a clip path cuts the border away with
 * everything else outside the shape, so the mark — the one element the whole
 * identity rests on — was invisible on the live page. An outlined `<polygon>`
 * has no such problem, scales cleanly, and keeps the digits upright the way a
 * punch would strike them.
 */
export const Poincon = (props: PoinconProps) => {
  const { tr } = useI18n();
  const { titre, size = "sm", className } = props;
  const width = size === "lg" ? 60 : 40;

  return (
    <svg
      viewBox="0 0 60 70"
      width={width}
      height={width * (70 / 60)}
      className={className}
      role="img"
      // A screen reader should hear the fact, not the shape.
      aria-label={
        /^\d+$/.test(titre)
          ? String(tr("hallmark.fineness", { args: [titre] }))
          : String(tr("hallmark.mark", { args: [titre] }))
      }
    >
      <polygon
        points="30,2 58,18 58,52 30,68 2,52 2,18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="30"
        y="35"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontSize={titre.length > 3 ? 15 : 18}
        letterSpacing="0.5"
        style={{ fontFamily: "var(--police-mesure)" }}
      >
        {titre}
      </text>
    </svg>
  );
};

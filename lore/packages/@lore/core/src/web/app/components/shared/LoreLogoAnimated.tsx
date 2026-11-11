import { useEffect, useId, useRef } from "react";

export interface LoreLogoAnimatedProps {
  /**
   * Sizing classes. The drawing scales to the box and takes the text colour,
   * so one drawing serves light and dark.
   */
  className?: string;
  /**
   * Lean toward the pointer, anywhere on the page, and glow as it comes
   * close. Off under `prefers-reduced-motion`, and on a touch screen there
   * is no pointer to follow, so the sprite simply hovers.
   */
  follow?: boolean;
}

/**
 * The Lore sprite drawn as a vector, for the large hero spots: wings that
 * beat, an orb that breathes, bubbles that rise and a star that twinkles.
 * The keyframes live in `main.css` (`.lore-logo-*`) and stop under
 * `prefers-reduced-motion`.
 *
 * With `follow`, a pointer listener writes three custom properties on the
 * `<svg>` (`--lore-x`, `--lore-y` in -1..1, `--lore-near` in 0..1), once per
 * frame at most; the lean and the glow are CSS transitions on them, so React
 * never re-renders for a mouse move.
 *
 * Small marks (header, favicon) keep the raster `LoreLogo`: the strokes are
 * drawn for a box of 96 px and up, and vanish at 22.
 */
const LoreLogoAnimated = (props: LoreLogoAnimatedProps) => {
  const id = useId();
  const wing = `lore-wing-${id}`;
  const wingRight = `lore-wing-right-${id}`;
  const orb = `lore-orb-${id}`;
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!props.follow || !svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = svg.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const clamp = (n: number) => Math.max(-1, Math.min(1, n));
        const x = clamp((event.clientX - cx) / (window.innerWidth / 2));
        const y = clamp((event.clientY - cy) / (window.innerHeight / 2));
        const distance = Math.hypot(event.clientX - cx, event.clientY - cy);
        const near = Math.max(0, 1 - distance / box.width);
        svg.style.setProperty("--lore-x", x.toFixed(3));
        svg.style.setProperty("--lore-y", y.toFixed(3));
        svg.style.setProperty("--lore-near", near.toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [props.follow]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Lore"
      className={`lore-logo text-foreground ${props.className ?? ""}`}
    >
      <defs>
        <linearGradient id={wing} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id={wingRight} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
        <radialGradient id={orb}>
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        className="lore-logo-glow"
        cx="100"
        cy="112"
        r="60"
        fill={`url(#${orb})`}
      />
      <g className="lore-logo-lean">
        <g
          className="lore-logo-body"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <g className="lore-logo-wing lore-logo-wing-left">
            <path
              d="M81 101 C70 80 46 54 14 30 C20 58 40 90 74 111 C77 108 79 105 81 101 Z"
              fill={`url(#${wing})`}
            />
            <path d="M21 39 C34 62 52 86 72 103" strokeWidth="0.8" />
            <path d="M48 76 L48 88 L70 105" strokeWidth="1.1" />
            <circle cx="48" cy="74" r="2.2" fill="currentColor" />
          </g>
          <g className="lore-logo-wing lore-logo-wing-right">
            <path
              d="M119 101 C130 80 154 54 186 30 C180 58 160 90 126 111 C123 108 121 105 119 101 Z"
              fill={`url(#${wingRight})`}
            />
            <path d="M179 39 C166 62 148 86 128 103" strokeWidth="0.8" />
            <path d="M152 76 L152 88 L130 105" strokeWidth="1.1" />
            <circle cx="152" cy="74" r="2.2" fill="currentColor" />
          </g>
          <g className="lore-logo-wing lore-logo-wing-low-left">
            <path
              d="M80 121 C68 124 54 131 46 140 C60 139 72 134 82 127 Z"
              fill={`url(#${wing})`}
            />
          </g>
          <g className="lore-logo-wing lore-logo-wing-low-right">
            <path
              d="M120 121 C132 124 146 131 154 140 C140 139 128 134 118 127 Z"
              fill={`url(#${wingRight})`}
            />
          </g>
          <circle
            className="lore-logo-halo"
            cx="100"
            cy="112"
            r="30"
            fill={`url(#${orb})`}
            stroke="none"
          />
          <circle className="lore-logo-orb" cx="100" cy="112" r="19" />
          <circle className="lore-logo-bubble" cx="121" cy="138" r="5.5" />
          <circle
            className="lore-logo-bubble lore-logo-bubble-2"
            cx="137"
            cy="154"
            r="4.5"
          />
          <circle
            className="lore-logo-bubble lore-logo-bubble-3"
            cx="141"
            cy="168"
            r="2.6"
          />
          <circle
            className="lore-logo-bubble lore-logo-bubble-4"
            cx="135"
            cy="179"
            r="1.6"
          />
          <path
            className="lore-logo-star"
            d="M121 151 Q122 158 129 159 Q122 160 121 167 Q120 160 113 159 Q120 158 121 151 Z"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>
    </svg>
  );
};

export default LoreLogoAnimated;

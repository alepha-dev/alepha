import type { Divergence } from "../../api/schemas/divergenceSchema.ts";

export interface WeaveProps {
  divergence?: Divergence;
  isMain: boolean;
}

/**
 * A worktree's divergence from the default branch, drawn as the logo draws:
 * a thread, and stitches across it.
 *
 * The horizontal thread is the branch. Each commit it has that the base
 * lacks is a warp stitch rising above it; each base commit it has not taken
 * yet is a grey stitch hanging below. A fresh worktree is a bare thread; a
 * busy one is dense above; a stale one trails grey. Main is the warp itself,
 * one solid violet line.
 *
 * Past {@link cap} stitches the count carries the rest: the drawing is for
 * the shape, the numbers are for the exact answer.
 */
export const Weave = (props: WeaveProps) => {
  const cap = 14;
  const step = 5;
  const width = 3 + cap * step;
  const mid = 9;

  if (props.isMain) {
    return (
      <span className="flex items-center gap-2" title="The default branch">
        <svg width={width} height={18} aria-hidden="true">
          <line
            x1={0}
            x2={width}
            y1={mid}
            y2={mid}
            stroke="var(--warp)"
            strokeWidth={2}
          />
        </svg>
      </span>
    );
  }

  const divergence = props.divergence;
  const ahead = divergence?.ahead ?? 0;
  const behind = divergence?.behind ?? 0;
  const label = divergence
    ? `${ahead} ahead of ${divergence.base}, ${behind} behind`
    : "Divergence unknown";

  return (
    <span className="flex items-center gap-2" title={label}>
      <svg width={width} height={18} role="img" aria-label={label}>
        <line
          x1={0}
          x2={width}
          y1={mid}
          y2={mid}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray={divergence ? undefined : "2 3"}
        />
        {Array.from({ length: Math.min(ahead, cap) }, (_, i) => (
          <line
            key={`a${i}`}
            x1={3 + i * step}
            x2={3 + i * step}
            y1={mid - 7}
            y2={mid}
            stroke="var(--warp)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {Array.from({ length: Math.min(behind, cap) }, (_, i) => (
          <line
            key={`b${i}`}
            x1={3 + i * step}
            x2={3 + i * step}
            y1={mid}
            y2={mid + 6}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.6}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
      </svg>
      {divergence && (
        <span className="font-mono text-[11px] leading-none tabular-nums">
          <span className="text-warp">{ahead}</span>
          <span className="text-muted-foreground">/{behind}</span>
        </span>
      )}
    </span>
  );
};

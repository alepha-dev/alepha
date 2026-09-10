import type { GitStatus } from "../../api/schemas/gitStatusSchema.ts";

export interface ChangesBadgeProps {
  status?: GitStatus;
  /**
   * Side-bar form: nothing when clean, letters only.
   */
  compact?: boolean;
}

/**
 * Uncommitted work as VS Code's source-control letters: `M` modified, `S`
 * staged, `U` untracked, `C` conflicted, each with its count.
 */
export const ChangesBadge = (props: ChangesBadgeProps) => {
  const status = props.status;
  if (!status) {
    return props.compact ? null : (
      <span className="text-muted-foreground">?</span>
    );
  }

  const parts = [
    {
      count: status.conflicted,
      letter: "C",
      word: "conflicted",
      tone: "text-fail",
    },
    {
      count: status.modified,
      letter: "M",
      word: "modified",
      tone: "text-warn",
    },
    { count: status.staged, letter: "S", word: "staged", tone: "text-ok" },
    {
      count: status.untracked,
      letter: "U",
      word: "untracked",
      tone: "text-ok/80",
    },
  ].filter((part) => part.count > 0);

  if (parts.length === 0) {
    return props.compact ? null : (
      <span className="text-muted-foreground">clean</span>
    );
  }

  return (
    <span
      className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium tabular-nums"
      title={parts.map((part) => `${part.count} ${part.word}`).join(", ")}
    >
      {parts.map((part) => (
        <span key={part.letter} className={part.tone}>
          {part.count}
          {part.letter}
        </span>
      ))}
    </span>
  );
};

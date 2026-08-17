import { getQuestRank } from "./questRank.ts";

export interface QuestDifficultyProps {
  difficulty: number;
}

const QuestDifficulty = (props: QuestDifficultyProps) => {
  const { difficulty } = props;

  const ringClass =
    difficulty === 5
      ? "border-yellow-400 shadow"
      : difficulty === 4
        ? "border-zinc-300 shadow"
        : difficulty === 3
          ? "border-border shadow-sm"
          : "border-border";

  // `bg-background` is the deepest surface layer in the shadcn token system —
  // distinct from `bg-card` (used by inactive QuestItem rows), `bg-accent`
  // (used by hover/active rows), and `bg-muted` (table cells, badges).
  // Keeps the rank box visually lifted in every container.
  return (
    <div
      className={`flex size-[25px] shrink-0 items-center justify-center rounded-md border bg-background ${ringClass}`}
    >
      <span className="text-sm font-bold leading-none">
        {getQuestRank(difficulty)}
      </span>
    </div>
  );
};

export default QuestDifficulty;

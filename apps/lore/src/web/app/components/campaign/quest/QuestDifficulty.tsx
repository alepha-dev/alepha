import { useInject } from "alepha/react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";

export interface QuestDifficultyProps {
  difficulty: number;
}

const QuestDifficulty = (props: QuestDifficultyProps) => {
  const info = useInject(CharacterInfo);
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
      className={`flex size-[25px] items-center justify-center rounded-md border bg-background ${ringClass}`}
    >
      <span className="text-sm font-bold leading-none">
        {info.getRank(difficulty)}
      </span>
    </div>
  );
};

export default QuestDifficulty;

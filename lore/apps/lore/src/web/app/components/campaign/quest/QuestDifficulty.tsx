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

  const bgClass = difficulty === 1 ? "bg-card" : "bg-muted";

  return (
    <div
      className={`flex size-[25px] items-center justify-center rounded-md border ${ringClass} ${bgClass}`}
    >
      <span className="text-sm font-bold leading-none">
        {info.getRank(difficulty)}
      </span>
    </div>
  );
};

export default QuestDifficulty;

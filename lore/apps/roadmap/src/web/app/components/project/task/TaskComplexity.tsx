import { useInject } from "alepha/react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";

export interface TaskComplexityProps {
  complexity: number;
}

const TaskComplexity = (props: TaskComplexityProps) => {
  const info = useInject(CharacterInfo);
  const { complexity } = props;

  const ringClass =
    complexity === 5
      ? "border-yellow-400 shadow"
      : complexity === 4
        ? "border-zinc-300 shadow"
        : complexity === 3
          ? "border-border shadow-sm"
          : "border-border";

  const bgClass = complexity === 1 ? "bg-card" : "bg-muted";

  return (
    <div
      className={`flex size-[25px] items-center justify-center rounded-md border ${ringClass} ${bgClass}`}
    >
      <span className="text-sm font-bold leading-none">
        {info.getRank(complexity)}
      </span>
    </div>
  );
};

export default TaskComplexity;

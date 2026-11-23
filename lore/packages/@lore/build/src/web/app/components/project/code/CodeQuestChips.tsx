import { Badge } from "@alepha/ui";
import type { Infer } from "alepha";
import { Link } from "alepha/react/router";

import type { codeQuestRefSchema } from "../../../../../api/schemas/codeQuestRefSchema.ts";

export interface CodeQuestChipsProps {
  projectSlug: string;
  quests: Infer<typeof codeQuestRefSchema>[];
}

/**
 * The quests a commit landed on (#Q4136), each a link to its page. A plain
 * path: Build links Plan's page without importing Plan.
 */
const CodeQuestChips = (props: CodeQuestChipsProps) => {
  if (props.quests.length === 0) return null;
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid="code-quests"
    >
      {props.quests.map((quest) => (
        <Link
          key={quest.number}
          href={`/${props.projectSlug}/quests/${quest.number}`}
          title={quest.title}
        >
          <Badge variant="outline" className="font-mono text-xs">
            #Q{quest.number}
          </Badge>
        </Link>
      ))}
    </span>
  );
};

export default CodeQuestChips;

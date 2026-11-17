import { currentProjectAtom, formatReference } from "@lore/core/web";
import { useStore } from "alepha/react";
import { Link, useRouter } from "alepha/react/router";

export interface QuestNumberLinksProps {
  numbers: number[];
  /**
   * How many to show before "+N"; the rest stay one click away on the
   * quest list.
   */
  max?: number;
  prefix?: string;
}

/**
 * Quest numbers as `#Q12` links to their pages (#E154).
 */
const QuestNumberLinks = (props: QuestNumberLinksProps) => {
  const [project] = useStore(currentProjectAtom);
  // `projectQuest` is Plan's page: Ship's routers cannot name it.
  const router = useRouter<any>();
  const max = props.max ?? 12;
  if (!project) {
    return null;
  }
  const shown = props.numbers.slice(0, max);
  const rest = props.numbers.length - shown.length;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {shown.map((n) => (
        <Link
          key={n}
          href={router.path("projectQuest", {
            params: { projectSlug: project.slug, shortId: String(n) },
          })}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-xs"
        >
          {`${props.prefix ?? ""}${formatReference("quest", n)}`}
        </Link>
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground text-xs">{`+${rest}`}</span>
      )}
    </span>
  );
};

export default QuestNumberLinks;

import ReleasePriorityPill from "./ReleasePriorityPill.tsx";

export interface ReleaseChangelogRowProps {
  shortId: number;
  title: string;
  priority: "optional" | "low" | "medium" | "high";
}

/**
 * One recorded quest in the changelog: its per-project ref, its title, and a
 * priority tag. Deliberately not a link — the changelog is a document you
 * read top to bottom, not a navigation surface.
 */
const ReleaseChangelogRow = (props: ReleaseChangelogRowProps) => (
  <div className="border-border/60 flex items-center gap-3 border-b px-0.5 py-2 last:border-b-0">
    <span className="text-muted-foreground w-9 shrink-0 font-mono text-[11px]">
      #{props.shortId}
    </span>
    <span className="min-w-0 flex-1 text-[13.5px]">{props.title}</span>
    <ReleasePriorityPill priority={props.priority} />
  </div>
);

export default ReleaseChangelogRow;

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@alepha/ui";

export interface AdminHostLoansProps {
  loans: ReadonlyArray<{ id: number | string; title: string }>;
}

/**
 * The projects a host is lent to, in one line (#Q4049): up to three names,
 * then "+N more", whose hover card lists every one, scrolling past a dozen.
 * A host may serve fifty projects, and a comma-joined fifty wrapped the row
 * into a paragraph.
 *
 * The trigger is a button, so the card opens on keyboard focus too.
 */
const AdminHostLoans = (props: AdminHostLoansProps) => {
  if (props.loans.length === 0) {
    return <span className="text-muted-foreground text-xs">none</span>;
  }
  const shown = props.loans.slice(0, 3);
  const rest = props.loans.length - shown.length;

  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap"
      data-testid="host-loans"
    >
      <span className="truncate">
        {shown.map((project) => project.title).join(", ")}
      </span>
      {rest > 0 && (
        <HoverCard>
          <HoverCardTrigger
            delay={150}
            render={
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-sm underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-[3px]"
                data-testid="host-loans-more"
              />
            }
          >
            +{rest} more
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="start"
            className="w-56 p-0"
            data-testid="host-loans-card"
          >
            <div className="text-muted-foreground border-b px-2.5 py-1.5 text-xs">
              Lent to {props.loans.length} projects
            </div>
            <ul className="max-h-64 overflow-y-auto py-1">
              {props.loans.map((project) => (
                <li key={project.id} className="truncate px-2.5 py-1 text-xs">
                  {project.title}
                </li>
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
      )}
    </span>
  );
};

export default AdminHostLoans;

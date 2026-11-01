import { useRouter } from "alepha/react/router";

export interface ReportsFolioListProps {
  folios: Array<{ shortId: number; title: string; detail?: string }>;
  /**
   * Shown instead of the list when there is nothing in it.
   */
  empty: string;
}

/**
 * Folios behind a figure, each opening its folio.
 */
const ReportsFolioList = (props: ReportsFolioListProps) => {
  const router = useRouter();

  if (props.folios.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">{props.empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {props.folios.map((folio) => (
        <li key={folio.shortId} className="flex items-center gap-3">
          <a
            {...router.anchor(
              "projectFoliosFolio" as never,
              {
                params: {
                  projectSlug: router.state.params.projectSlug,
                  shortId: String(folio.shortId),
                },
              } as never,
            )}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {folio.title}
          </a>
          {folio.detail ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {folio.detail}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

export default ReportsFolioList;

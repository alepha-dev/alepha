import type { Page } from "alepha";
import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { Button } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";

export interface DataTableCompactPagerProps {
  /**
   * The current page's metadata, `null` until a page has arrived.
   */
  meta: Page<unknown>["page"] | null;
  setPage: Dispatch<SetStateAction<number>>;
  className?: string;
}

/**
 * The pager of `pagination="compact"`: where the reader is, and two
 * chevrons. No size picker, no numbered pages, no tinted band.
 *
 * For a table laid inside something small, a dialog's content pane above
 * all, where the full footer is a second toolbar under a list of five rows.
 * Drawn only while there is somewhere to go: a single page has no pager.
 */
export const DataTableCompactPager = (props: DataTableCompactPagerProps) => {
  const { meta, setPage } = props;
  const { tr, l } = useI18n();
  if (!meta || (meta.isFirst && meta.isLast)) return null;
  return (
    <nav
      aria-label={tr("dataTable.pagination", { default: "Pagination" })}
      className={cn(
        "text-muted-foreground flex items-center justify-end gap-1 text-xs",
        props.className,
      )}
    >
      <span className="mr-1">
        {meta.totalPages
          ? tr("dataTable.pageOf", {
              default: "Page $1 of $2",
              args: [l(meta.number + 1), l(meta.totalPages)],
            })
          : tr("dataTable.page", {
              default: "Page $1",
              args: [l(meta.number + 1)],
            })}
      </span>
      <Button
        type="button"
        variant="minimal"
        size="icon-sm"
        disabled={meta.isFirst}
        aria-label={tr("dataTable.previousPage", {
          default: "Go to previous page",
        })}
        onClick={() => setPage((p) => Math.max(0, p - 1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="minimal"
        size="icon-sm"
        disabled={meta.isLast}
        aria-label={tr("dataTable.nextPage", {
          default: "Go to next page",
        })}
        onClick={() => setPage((p) => p + 1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
};

import type { Page, ZObject, ZodNumber } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { Dispatch, SetStateAction } from "react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../core/Pagination.tsx";
import { cn } from "../core/utils.ts";
import { Control } from "../form/Control.tsx";

export interface DataTableFooterProps {
  /**
   * Sizes offered in the picker, as passed to the table. Defaults to
   * {@link PAGE_SIZES}.
   */
  pageSizes?: number[];
  /**
   * The picker's one-field form, owned by the table.
   */
  sizeForm: FormModel<ZObject<{ size: ZodNumber }>>;
  /**
   * The current page's metadata, `null` until a page has arrived.
   */
  meta: Page<unknown>["page"] | null;
  isMobile: boolean;
  setPage: Dispatch<SetStateAction<number>>;
  /**
   * The table's `chromeClassName`, merged after the bar's own classes.
   */
  className?: string;
}

/**
 * The footer under the rows: the page-size picker, where the reader is, and
 * the page links.
 */
export const DataTableFooter = (props: DataTableFooterProps) => {
  const { sizeForm, meta, isMobile, setPage } = props;
  const pageSizes = props.pageSizes ?? PAGE_SIZES;
  const { tr, l } = useI18n();

  return (
    /* `bg-muted`, paired with the filter bar above, see the note on it in
        `DataTableToolbar.tsx`.
        Carries the same `--bevel` fold under its top border: the three
        chrome bands (filter bar, header, footer) are lit from one side, so
        they read as the same material at three different heights. */
    <div
      className={cn(
        "bg-muted -mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md rounded-t-none border p-2 shadow-[inset_0_1px_0_0_var(--bevel)]",
        props.className,
      )}
    >
      {/* The size picker sits with the count, not in the toolbar above:
          this line already answers "how many, where am I", while the
          toolbar answers "which rows". Mixing the two turns the toolbar
          into a junk drawer. */}
      <div className="flex items-center gap-2">
        {/*
          Hidden on a phone, and the size itself is untouched: `size` is
          persisted per table, so a reader who chose 50 on a desktop keeps
          50 here — this drops the CONTROL, not the setting. Nobody picks
          100 rows on a 412px screen, and the picker plus the range text
          plus the numbered pages is exactly what made this bar wrap onto
          three lines (feedback #2106).
        */}
        {pageSizes.length > 0 &&
          !isMobile && (
            // The same `Control` the filter bar is built on, so the picker
            // is one component with every other select in this table. It
            // used to be the raw `Select` underneath it, because `Control`
            // is form-bound and this is not a form — `sizeForm` (built in
            // `useDataTableData`) is
            // what closes that gap.
            <Control
              input={sizeForm.input.size}
              // The count line beside it is not a label, so the trigger has
              // to name itself.
              label=""
              inputProps={{
                "aria-label": tr("table.pageSize", {
                  default: "Rows per page",
                }),
              }}
              // `bg-background`, because this bar is `bg-muted` and the
              // trigger is `bg-transparent` by default: on a plain form
              // surface that blending is right, on a tinted bar it made the
              // picker read as part of the bar while the pagination buttons
              // beside it sat on their own plane. Set here rather than on
              // the trigger itself, which every form still wants
              // transparent.
              triggerClassName="bg-background h-7 w-auto gap-1 text-xs"
              items={pageSizes.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
            />
          )}
        <p className="text-muted-foreground text-xs">
          {meta
            ? // The row range is the half that goes on a phone: "where am
              // I" survives, "how many of how many" does not, and the two
              // together are what pushed this past one line.
              //
              // Every part is the reader's language: the words through the
              // catalogue, the numbers through `l()`, so a French table
              // reads "Page 1 sur 113 · 20 sur 2 250" rather than an English
              // line with a French table above it (#Q2392).
              `${
                meta.totalPages
                  ? tr("dataTable.pageOf", {
                      default: "Page $1 of $2",
                      args: [l(meta.number + 1), l(meta.totalPages)],
                    })
                  : tr("dataTable.page", {
                      default: "Page $1",
                      args: [l(meta.number + 1)],
                    })
              }${
                isMobile
                  ? ""
                  : ` · ${tr("dataTable.rowsOf", {
                      default: "$1 of $2",
                      args: [
                        l(meta.numberOfElements),
                        meta.totalElements === undefined
                          ? "?"
                          : l(meta.totalElements),
                      ],
                    })}`
              }`
            : "—"}
        </p>
      </div>
      {meta && meta.totalPages && meta.totalPages > 1 ? (
        <Pagination
          className="mx-0 w-auto justify-end"
          aria-label={tr("dataTable.pagination", { default: "Pagination" })}
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text={tr("dataTable.previous", { default: "Previous" })}
                aria-label={tr("dataTable.previousPage", {
                  default: "Go to previous page",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  if (!meta.isFirst) setPage((p) => Math.max(0, p - 1));
                }}
                aria-disabled={meta.isFirst}
                className={cn(meta.isFirst && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            {/*
              Previous/next only on a phone. The numbered sequence is up
              to seven tap targets plus two ellipses, which is the widest
              thing in this bar, and "Page 1 of 3" beside it already says
              where the reader is. Their labels are `hidden sm:block` in
              the primitive, so the two that remain are bare chevrons.
            */}
            {!isMobile &&
              computePageItems(meta.number + 1, meta.totalPages).map(
                (item, idx) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`e-${idx}`}>
                      <PaginationEllipsis
                        label={tr("dataTable.morePages", {
                          default: "More pages",
                        })}
                      />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href="#"
                        isActive={item === meta.number + 1}
                        onClick={(e) => {
                          e.preventDefault();
                          setPage(item - 1);
                        }}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  ),
              )}
            <PaginationItem>
              <PaginationNext
                href="#"
                text={tr("dataTable.next", { default: "Next" })}
                aria-label={tr("dataTable.nextPage", {
                  default: "Go to next page",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  if (!meta.isLast) setPage((p) => p + 1);
                }}
                aria-disabled={meta.isLast}
                className={cn(meta.isLast && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
};

/**
 * Build the visible page-number sequence with ellipses. Always shows
 * first + last, ±1 around current. Gaps collapse into a single ellipsis.
 * `current` and `total` are 1-indexed.
 */
function computePageItems(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Array<number | "ellipsis"> = [1];
  if (current > 3) items.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) items.push(i);
  if (current < total - 2) items.push("ellipsis");
  items.push(total);
  return items;
}

/**
 * Page sizes the footer offers.
 *
 * No "all". Pagination here is server-side, so an unbounded fetch is a query
 * whose cost grows with the biggest table in the product and is paid by the
 * reader who can least afford it. 100 covers "let me scan the lot" without
 * that.
 */
export const PAGE_SIZES = [10, 20, 50, 100];

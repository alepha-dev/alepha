import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface DetailTab {
  value: string;
  label: React.ReactNode;
  /**
   * Rendered at `size-4` before the label. Passed as a component rather than
   * an element so callers hand over data — every detail page used to repeat
   * the same `inline-flex items-center gap-1.5` wrapper by hand.
   */
  icon?: IconType;
}

export interface DetailNotFound {
  message: string;
  backLabel: string;
  onBack: () => void;
}

export interface DetailLayoutProps {
  /** The identity panel. Usually an {@link DetailAside}. */
  aside: React.ReactNode;
  tabs: DetailTab[];
  tab: string;
  onTabChange: (value: string) => void;
  /**
   * Buttons for the right end of the toolbar.
   *
   * Size them `lg`. `Segmented`'s size tokens are cut to match a `<Button>`
   * of the same token exactly, the tab selector on the left of this bar is
   * `lg`, and nothing here can size what a caller passes: a `sm` button
   * beside it is 28px against 36px, both centred in a 56px bar, and the two
   * ends of the toolbar stop lining up.
   */
  actions?: React.ReactNode;
  /**
   * Replaces the whole shell with a skeleton. Pass it only for the first load —
   * a refetch that blanks the page an operator is reading is a regression, so
   * a caller should gate this on "loading **and** no data yet".
   */
  loading?: boolean;
  /** Replaces the whole shell with a message and a way back. */
  notFound?: DetailNotFound;
  children?: React.ReactNode;
}

/**
 * The shell every detail page shares: a full-height identity aside, and a
 * right column whose toolbar carries tab selection on the left and actions on
 * the right.
 *
 * It lived at `components/admin/admin-detail-layout` while admin pages were
 * its only consumers, and moved here when Lore's Epic page became the first
 * one outside admin. Nothing about it was ever admin-specific — it imports a
 * button, a segmented control and a skeleton — so the old name described the
 * callers rather than the component. There is deliberately **no re-export
 * left behind at the old path**: an alias nobody is forced to notice is an
 * alias nobody removes.
 *
 * It owns the chrome and nothing else. Data, forms and mutations stay in the
 * page that composes it, and each tab body is its own component that renders
 * what it is given — the split that keeps a detail page from growing into one
 * unreadable file.
 *
 * The aside is hidden below `md`. A phone gets the tabs full width rather than
 * a 288px column and a sliver of content; the same facts are reachable from
 * the tab bodies.
 *
 * ```tsx
 * const [tab, setTab] = useDetailTab<"overview" | "stock">("overview");
 *
 * <DetailLayout
 *   aside={<DetailAside title={product.name} rows={rows} />}
 *   tabs={[{ value: "overview", label: "Overview", icon: Package }]}
 *   tab={tab}
 *   onTabChange={(v) => setTab(v as typeof tab)}
 *   actions={<Button size="sm">Publish</Button>}
 * >
 *   {tab === "overview" && <OverviewTab product={product} />}
 * </DetailLayout>
 * ```
 *
 * Dialogs belong beside it, not inside `children` — they portal out anyway,
 * and nesting them in the tab body unmounts them on a tab switch.
 */
export const DetailLayout = (props: DetailLayoutProps) => {
  if (props.loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (props.notFound) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-muted-foreground text-sm">
          {props.notFound.message}
        </p>
        <Button variant="outline" onClick={props.notFound.onBack}>
          <ArrowLeft className="size-4" />
          {props.notFound.backLabel}
        </Button>
      </div>
    );
  }

  const options = props.tabs.map((entry) => {
    const Icon = entry.icon;
    return {
      value: entry.value,
      label: Icon ? (
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-4" />
          {entry.label}
        </span>
      ) : (
        entry.label
      ),
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* `p-4`, not `p-6`. The aside is a fixed 288px, so its padding comes
          straight out of the identity panel's width: at 24px a side the
          `DetailAside` card had 240px to fit a label, a value and sometimes
          a copy button, and read as undersized in a column that had room to
          spare. 16px gives it back 16px of card without letting the content
          touch the border. */}
      <aside className="border-border bg-background hidden w-72 shrink-0 flex-col gap-4 overflow-auto border-r p-4 md:flex">
        {props.aside}
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-background flex h-14 shrink-0 items-center gap-2 border-b px-4">
          {/* `lg` (h-9), not the `sm` (h-7) this started on. The toolbar is
              `h-14`, so at 28px the control filled exactly half of it and
              read as a small thing floating in a tall bar.

              This does give up the pixel-for-pixel match with the toolbar's
              action buttons: all three consumers pass `size="sm"`, so the
              two were the same 28px before and are 28 vs 36 now. The match
              only ever held because both happened to pick the same token,
              and `actions` is caller JSX this component cannot size, so any
              increase here breaks it. Both are centred in a 56px bar, which
              is why 8px of difference does not show. */}
          <Segmented
            size="lg"
            options={options}
            value={props.tab}
            onChange={props.onTabChange}
          />
          {props.actions ? (
            <div className="ml-auto flex items-center gap-2">
              {props.actions}
            </div>
          ) : null}
        </div>
        {props.children}
      </div>
    </div>
  );
};

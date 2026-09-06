import { PlateLayout } from "@alepha/ui/components/plate-layout/plate-layout";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { z } from "alepha";
import { useRouterState } from "alepha/react/router";
import {
  Gauge,
  ListTree,
  Package,
  Pencil,
  Rocket,
  ScrollText,
  Workflow,
} from "lucide-react";
import { useState } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The other tab shell, and the reason there are two.
 *
 * `PlateLayout` is for a page whose identity is several facts wide and whose
 * sections are big enough to be their own view; `Detail` is for a page whose
 * identity is one line and whose sections are fields. Underlined tabs along
 * the bottom edge of a full-width band, rather than a `Segmented` control in a
 * toolbar, follow from that: this bar IS the band's last row.
 *
 * The `Tab kind` knob is the component's real subject. A tab that swaps a
 * panel inside one route is state and renders as a button in a `tablist`; a
 * tab that IS its own route has to be a `Link` in a `navigation`, or
 * middle-click, copy-link and the back button all stop working. The layout
 * does not care which, which is what lets Lore's App page (nested routes) and
 * its Release view (one route with a `?tab=`) share it.
 *
 * Boxed to the whole preview pane, and the box is a FLEX container:
 * `PlateLayout` is `min-h-0 flex-1 overflow-hidden` with no height of its own,
 * so it fills a flex parent rather than a block one. `Showcase`'s `fill` gives
 * the pane a definite height, and the box stands in for the application shell
 * that has already taken the viewport.
 */
const KNOBS = z.object({
  tabs: z
    .enum(["links", "buttons"])
    .default("links")
    .meta({ title: "Tab kind" }),
  plate: z.boolean().default(true).meta({ title: "Plate" }),
  icons: z.boolean().default(true).meta({ title: "Tab icons" }),
  counts: z.boolean().default(true).meta({ title: "Tab counts" }),
  scroll: z.boolean().default(true).meta({ title: "scroll" }),
});

/**
 * Overview carries no count on purpose: `undefined` renders the bare label
 * rather than a confident "0", which is a lie while a collection is still
 * loading. A resolved zero is an answer and is shown.
 */
const TABS = [
  {
    key: "overview",
    label: "Overview",
    icon: Gauge,
    count: undefined,
    body: "The band above the tabs is a slot, not a set of props: there is no shape common to a release's tag and progress bar, an app's address, and a reporting period. The layout owns the band, not its contents.",
  },
  {
    key: "contents",
    label: "Contents",
    icon: ListTree,
    count: 12,
    body: "A count sits in a pill of its own rather than folded into the label, because the pill's colour has to follow the tab's state and only the bar knows it.",
  },
  {
    key: "changelog",
    label: "Changelog",
    icon: ScrollText,
    count: 3,
    body: "The tab Lore passes scroll={false} for: it has a sticky toolbar and a reading measure, so it owns its scrolling. Nesting a scroll region inside a scroll region gives it two.",
  },
  {
    key: "artifacts",
    label: "Artifacts",
    icon: Package,
    count: 0,
    body: "A resolved zero is shown, unlike an unresolved count. The difference is the whole reason count is a number rather than a node.",
  },
  {
    key: "flow",
    label: "Flow",
    icon: Workflow,
    count: undefined,
    body: "The other scroll={false} case: a view that pans and zooms instead of scrolling, where a scroll region around it would give the wheel two things to do.",
  },
];

const ROWS = [
  "Rename an epic without losing its quests",
  "The board sorts by weight, not by label",
  "A folio moved to trash keeps its history",
  "Sigil keys name their own project",
  "Migrations refuse a cascade on D1",
  "The rail stays put while the column scrolls",
  "An unknown tab falls back to the first",
  "Counts resolve before they are shown",
  "Dialogs portal out of the tab body",
  "A link tab survives a middle click",
  "The plate is optional, and so is its rule",
  "Two blocks, because they are two shapes",
];

const Plate = () => {
  const state = useRouterState();

  // The button shape is a panel swap inside one route, so its selection is
  // local state and the URL never moves.
  const [panel, setPanel] = useState("overview");

  /**
   * The link shape navigates, so its href is built from the CURRENT url rather
   * than from a literal path. Inside the viewport iframe the page is
   * `/preview?p=blocks/Plate`, and an href that dropped `p` would send the
   * frame to a preview of nothing.
   */
  const hrefFor = (key: string) => {
    const params = new URLSearchParams(state.url.searchParams);
    params.set("tab", key);
    return `${state.url.pathname}?${params.toString()}`;
  };

  return (
    <Showcase
      id="blocks/Plate"
      title="Plate"
      description="A full-width plate over a tab strip, and a body under both."
      schema={KNOBS}
      initialValues={{
        tabs: "links",
        plate: true,
        icons: true,
        counts: true,
        scroll: true,
      }}
      fill
    >
      {(v) => {
        const linked = v.tabs === "links";
        const active = linked
          ? (state.url.searchParams.get("tab") ?? "overview")
          : panel;
        // A `?tab=` nobody offers is a hand-edited URL, not an error.
        const current = TABS.find((tab) => tab.key === active) ?? TABS[0];

        return (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
            <PlateLayout
              tabsTestId="plate-tabs"
              active={current.key}
              scroll={v.scroll}
              // Nothing for a routed bar to call back to: the Link already
              // navigated, and the URL is the state.
              onSelect={linked ? undefined : setPanel}
              tabs={TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                icon: v.icons ? tab.icon : undefined,
                count: v.counts ? tab.count : undefined,
                href: linked ? hrefFor(tab.key) : undefined,
              }))}
              plate={
                v.plate ? (
                  <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold tracking-tight">
                          0.28.0
                        </h2>
                        <Badge variant="tint" tone="success">
                          published
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Shipped 4 September 2026, 12 quests across 3 epics.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" size="sm">
                        <Pencil /> Edit
                      </Button>
                      <Button size="sm">
                        <Rocket /> Publish
                      </Button>
                    </div>
                  </div>
                ) : undefined
              }
            >
              {/* Padding only when the layout is the scroller. With
                  `scroll={false}` the body IS the scroller, which is the
                  contract that flag exists for - the layout's own root is
                  `overflow-hidden`, so a tall body that scrolls nowhere is
                  simply clipped. */}
              <div
                className={cn(
                  "p-6",
                  !v.scroll && "min-h-0 flex-1 overflow-y-auto",
                )}
              >
                <div className="mx-auto max-w-3xl space-y-4">
                  <div>
                    <h3 className="text-sm font-medium">{current.label}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {current.body}
                    </p>
                  </div>
                  <div className="divide-y overflow-hidden rounded-lg border">
                    {ROWS.map((row) => (
                      <div
                        key={row}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      >
                        <span className="truncate">{row}</span>
                        <Badge variant="outline" className="shrink-0">
                          {current.label}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </PlateLayout>
          </div>
        );
      }}
    </Showcase>
  );
};

export default Plate;

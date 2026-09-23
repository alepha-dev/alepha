import { Kbd } from "@alepha/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@alepha/ui/command";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import { HomeSearchRow, type HomeSearchRowItem } from "./HomeSearchRow.tsx";
import { useHomeSearch } from "./useHomeSearch.ts";
import { useHomeSearchHitHref } from "./useHomeSearchHitHref.ts";

export interface HomeSearchProps {
  /**
   * Every project, most recently active first: the empty box offers the
   * first few, and the search runs over all of them.
   */
  projects: ProjectOverviewResource[];
}

/**
 * Home's search box, framed and ruled, with its results in a dropdown.
 *
 * ## The frame
 *
 * A hairline runs across the whole band at the box's mid-height, from rail to
 * rail, and stops at a frame around the input: the box reads as set INTO the
 * page's grid rather than floating on it. The frame is opaque so the rule
 * disappears behind it instead of striking through the input.
 *
 * `CommandInput` draws a compact palette field of its own; the frame restyles
 * it through its `data-slot`s rather than forking it, so the keyboard model
 * (arrows move the highlight, Enter opens it) stays the palette's.
 *
 * ## The dropdown
 *
 * Opens when the box is focused or clicked, and floats over the page rather
 * than pushing the project list down. Empty, it offers the most recent
 * projects; with a query, the projects named like it, then each project's
 * hits under its name. It closes on Escape, on a pointer press outside the
 * search, and when a row is chosen. The keyboard hints under the rows are
 * hidden on a phone, which has no arrow keys to hint at.
 */
export const HomeSearch = (props: HomeSearchProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const hitHref = useHomeSearchHitHref();
  const search = useHomeSearch(props.projects);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A pointer press anywhere outside the search closes the dropdown. Not a
  // blur on the input: a row is not focusable, so pressing one blurs the input
  // before its click lands, and the dropdown would vanish under the pointer.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const projectHref = (project: ProjectOverviewResource) =>
    router.path("project", { params: { projectSlug: project.slug } });
  const projectRow = (project: ProjectOverviewResource): HomeSearchRowItem => ({
    key: `project:${project.id}`,
    kind: "project",
    project,
    href: projectHref(project),
  });

  const searching = search.query.trim().length > 0;
  const groups: HomeSearchGroupItem[] = (
    searching
      ? [
          {
            key: "projects",
            heading: tr("home.search.projects"),
            items: search.projectMatches.map(projectRow),
          },
          ...search.groups.map((group) => ({
            key: `hits:${group.project.id}`,
            heading: group.project.title,
            items: group.hits.map((hit): HomeSearchRowItem => ({
              key: `${hit.kind}:${hit.id}`,
              kind: "hit",
              hit,
              project: group.project,
              href: hitHref(group.project.slug, hit),
            })),
          })),
        ]
      : [
          {
            key: "recent",
            heading: tr("home.recent.title"),
            items: props.projects.slice(0, RECENT).map(projectRow),
          },
        ]
  ).filter((group) => group.items.length > 0);

  const select = (item: HomeSearchRowItem) => {
    setOpen(false);
    void router.push(item.href);
  };

  return (
    <div className="relative">
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute inset-x-0 top-1/2 h-px"
      />
      <div className="relative mx-auto w-full max-w-5xl px-4 sm:px-8">
        <div ref={rootRef} className="relative">
          <Command<HomeSearchGroupItem>
            items={groups}
            // Ranked already: project names in the browser, hits by the
            // server. Left on `list`, the palette would rank them again.
            mode="none"
            value={search.query}
            onValueChange={(value) => {
              search.update(value);
              setOpen(true);
            }}
            className="size-auto overflow-visible rounded-none! bg-transparent p-0"
          >
            <div className="bg-background rounded-2xl border">
              <div className="bg-muted/50 [&_[data-slot=input-group]]:bg-background! [&_[data-slot=input-group]]:border-border! rounded-[inherit] p-1.5 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group-addon]]:pl-3.5! [&_[data-slot=input-group]]:h-11! [&_[data-slot=input-group]]:rounded-xl! [&_[data-slot=input-group]]:shadow-xs!">
                <CommandInput
                  placeholder={tr("home.search.placeholder")}
                  aria-label={tr("home.search.placeholder")}
                  className="text-base"
                  onFocus={() => setOpen(true)}
                  onClick={() => setOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setOpen(false);
                  }}
                />
              </div>
            </div>
            {open && (
              <div className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border shadow-lg">
                <CommandEmpty className="text-muted-foreground">
                  {search.loading
                    ? tr("home.search.searching")
                    : tr("home.search.empty")}
                </CommandEmpty>
                <CommandList className="max-h-[60vh] p-1.5">
                  {(group: HomeSearchGroupItem) => (
                    <CommandGroup
                      key={group.key}
                      items={group.items}
                      heading={group.heading}
                    >
                      {(item: HomeSearchRowItem) => (
                        <HomeSearchRow
                          key={item.key}
                          item={item}
                          onSelect={select}
                        />
                      )}
                    </CommandGroup>
                  )}
                </CommandList>
                <div className="bg-muted/40 text-muted-foreground flex items-center gap-5 border-t px-4 py-2.5 text-xs max-sm:hidden">
                  <span className="flex items-center gap-1.5">
                    <Kbd>
                      <ArrowUp />
                    </Kbd>
                    <Kbd>
                      <ArrowDown />
                    </Kbd>
                    {tr("home.search.navigate")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Kbd>
                      <CornerDownLeft />
                    </Kbd>
                    {tr("home.search.select")}
                  </span>
                </div>
              </div>
            )}
          </Command>
        </div>
      </div>
    </div>
  );
};

/**
 * One heading of the dropdown and its rows.
 */
interface HomeSearchGroupItem {
  [key: string]: unknown;
  key: string;
  heading: string;
  items: HomeSearchRowItem[];
}

/**
 * Projects the empty box offers.
 */
const RECENT = 5;

import {
  AppShell,
  type NavGroup,
} from "@alepha/ui/components/app-shell/app-shell";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { useRouterState } from "alepha/react/router";
import {
  Bell,
  BookText,
  Boxes,
  FolderKanban,
  Gauge,
  Home as HomeIcon,
  ListChecks,
  Rocket,
  Search,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * A whole `AppShell` in a box, rather than knobs that reshape the site.
 *
 * ## Why it stopped driving the real one
 *
 * This page used to write a `persist: "localStorage"` atom that `Layout` read,
 * so the knobs changed the shell around the page instead of a copy of it. That
 * was the only way to show `AppShell` before its `fill` prop made a contained
 * copy possible, and it had a cost nobody signed up for: trying `inset` left
 * the entire site inset, on every later visit, from a page the reader had
 * already left. A specimen that escapes its page is not a specimen.
 *
 * `fill` is what makes the box possible. It re-anchors the otherwise
 * viewport-fixed rail to the shell's own wrapper - the same mechanism
 * `/blocks/sidebar` borrows by hand - so a second shell can live inside the
 * first without lying across it.
 *
 * ## What a nested shell shares, and what it does not
 *
 * `embedded` is not optional here. Without it the shell mounts its own
 * `DialogProvider` and `<Toaster />`, and a second toaster under an app that
 * already has one shows every toast twice. `progress={false}` for the same
 * reason: two `NavigationProgress` bars would both answer the next route
 * change.
 *
 * ⚠️ **The collapse state is shared, and cannot be unshared from here.**
 * `AppShell` keeps it in `uiAtom` through `useSidebarState`, which is one
 * value per application - so collapsing this rail collapses the page's rail
 * with it. That is a true fact about mounting two shells in one app rather
 * than an artefact of the preview, and it is worth knowing before doing it.
 */
const KNOBS = z.object({
  variant: z
    .enum(["sidebar", "floating", "inset"])
    .default("floating")
    .meta({ title: "variant" }),
  headerOutside: z.boolean().default(false).meta({ title: "headerOutside" }),
  breadcrumbs: z.boolean().default(true).meta({ title: "breadcrumbs" }),
  topbar: z.boolean().default(true).meta({ title: "topbarActions" }),
  footer: z.boolean().default(true).meta({ title: "sidebarFooter" }),
  navAccordion: z.boolean().default(true).meta({ title: "navAccordion" }),
  navAnimate: z.boolean().default(true).meta({ title: "navAnimate" }),
  navToggleIcon: z
    .enum(["caret", "plusMinus"])
    .default("caret")
    .meta({ title: "navToggleIcon" }),
});

const GROUPS: {
  label?: string;
  items: {
    key: string;
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    badge?: number;
    children?: { key: string; label: string }[];
  }[];
}[] = [
  { items: [{ key: "home", label: "Home", icon: HomeIcon }] },
  {
    label: "Workspace",
    items: [
      // A second collapsible group, and deliberately in a different
      // `SidebarGroup` from Insights: `navAccordion` coordinates ACROSS the
      // groups, so one expandable rail would have shown the knob doing
      // nothing.
      {
        key: "projects",
        label: "Projects",
        icon: FolderKanban,
        children: [
          { key: "projects-active", label: "Active" },
          { key: "projects-archived", label: "Archived" },
        ],
      },
      { key: "quests", label: "Quests", icon: ListChecks, badge: 12 },
      { key: "folios", label: "Folios", icon: BookText },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "apps", label: "Apps", icon: Boxes, badge: 3 },
      { key: "releases", label: "Releases", icon: Rocket },
      {
        key: "insights",
        label: "Insights",
        icon: Gauge,
        children: [
          { key: "analytics", label: "Analytics" },
          { key: "vitals", label: "Vitals" },
          { key: "errors", label: "Errors" },
        ],
      },
    ],
  },
];

const Shell = () => {
  const state = useRouterState();

  /**
   * Every entry is a real destination, and they are all this page.
   *
   * ⚠️ Not one shared href for all of them, which is what this started as.
   * `AppShell` keys a nav item by its `href` - the fallback index key is only
   * for an item that has none - so eleven rows pointing at `/blocks/shell`
   * were eleven React children with the same key, and the console said so
   * eleven times while the rail rendered perfectly.
   *
   * Built from the CURRENT url rather than a literal path, for the same reason
   * `/blocks/plate` does it: inside the viewport iframe the page is
   * `/preview?p=blocks/Shell`, and an href that dropped `p` would send the
   * frame to a preview of nothing.
   */
  const hrefFor = (key: string) => {
    const params = new URLSearchParams(state.url.searchParams);
    params.set("nav", key);
    return `${state.url.pathname}?${params.toString()}`;
  };

  const current = state.url.searchParams.get("nav") ?? "projects";

  const nav: NavGroup[] = GROUPS.map((group) => ({
    label: group.label,
    items: group.items.map((item) =>
      item.children
        ? {
            label: item.label,
            icon: item.icon,
            // Open from the start. `defaultOpen` falls back to "does a
            // descendant match", and nothing under here is the current entry
            // on first load, so without it the sub-menu is a chevron the
            // reader has to find before the group shows anything.
            defaultOpen: true,
            // A group has no href of its own: `AppShell` ignores one, because
            // an item with children is a toggle rather than a destination.
            children: item.children.map((child) => ({
              label: child.label,
              href: hrefFor(child.key),
              active: current === child.key,
            })),
          }
        : {
            label: item.label,
            icon: item.icon,
            badge: item.badge,
            href: hrefFor(item.key),
            active: current === item.key,
          },
    ),
  }));

  return (
    <Showcase
      id="blocks/Shell"
      title="App shell"
      description="The frame an application mounts once, in three variants."
      schema={KNOBS}
      initialValues={{
        variant: "floating",
        headerOutside: false,
        breadcrumbs: true,
        topbar: true,
        footer: true,
        navAccordion: true,
        navAnimate: true,
        navToggleIcon: "caret",
      }}
      fill
    >
      {(v) => (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          <AppShell
            // `fill` bounds the shell to this box instead of the viewport, and
            // is what re-anchors the rail into it. `embedded` and
            // `progress={false}` keep the second shell from duplicating the
            // first one's toaster and loading bar - see the note above.
            fill
            embedded
            progress={false}
            variant={v.variant}
            headerOutside={v.headerOutside}
            nav={nav}
            navAccordion={v.navAccordion}
            navAnimate={v.navAnimate}
            navToggleIcon={v.navToggleIcon}
            brand={
              <div className="flex items-center gap-2 px-2 py-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                  α
                </span>
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  Acme
                </span>
              </div>
            }
            breadcrumbs={
              v.breadcrumbs
                ? [
                    { label: "Workspace", href: hrefFor("projects") },
                    { label: "Projects", href: hrefFor("projects") },
                    { label: "Onboarding" },
                  ]
                : undefined
            }
            topbarActions={
              v.topbar ? (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label="Search">
                    <Search />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Notifications"
                  >
                    <Bell />
                  </Button>
                </>
              ) : undefined
            }
            sidebarFooter={
              v.footer ? (
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                  <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-medium">
                    AL
                  </span>
                  <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                    Ada Lovelace
                  </span>
                </div>
              ) : undefined
            }
          >
            {/* `fill` makes the shell's own `<main>` `min-h-0 flex-1
                overflow-hidden`, so the page inside it is the scroller. */}
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <div className="max-w-2xl space-y-4 text-sm">
                <p>
                  The frame an application mounts once and routes into.{" "}
                  <code className="bg-muted rounded px-1">children</code>{" "}
                  defaults to{" "}
                  <code className="bg-muted rounded px-1">
                    &lt;NestedView /&gt;
                  </code>
                  , so a real app passes nothing here and lets the router fill
                  it. The rail is live: every entry is a link back to this page
                  with a different{" "}
                  <code className="bg-muted rounded px-1">?nav=</code>, which is
                  what moves the active marker.
                </p>
                <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-foreground font-medium">sidebar</span>{" "}
                    - flush, side by side.
                  </li>
                  <li>
                    <span className="text-foreground font-medium">
                      floating
                    </span>{" "}
                    - the page owns the background, the rail is a card on it.
                  </li>
                  <li>
                    <span className="text-foreground font-medium">inset</span> -
                    the rail owns the background, the page is the card.
                  </li>
                  <li>
                    <span className="text-foreground font-medium">
                      headerOutside
                    </span>{" "}
                    applies to inset alone, so its switch does nothing on the
                    other two.
                  </li>
                </ul>
                <p className="text-muted-foreground">
                  The rail itself, its groups, badges and sub-menus, has its own
                  page at{" "}
                  <code className="bg-muted rounded px-1">/blocks/sidebar</code>
                  . This one is about the frame around it: the top bar, the
                  breadcrumbs, and how the two surfaces meet.
                </p>
              </div>
            </div>
          </AppShell>
        </div>
      )}
    </Showcase>
  );
};

export default Shell;

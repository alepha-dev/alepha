import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@alepha/ui/components/ui/sidebar";
import { cn } from "@alepha/ui/lib/utils";
import { z } from "alepha";
import {
  BookText,
  Boxes,
  ChevronRight,
  FolderKanban,
  Gauge,
  Home as HomeIcon,
  LifeBuoy,
  ListChecks,
  Rocket,
} from "lucide-react";
import { useState } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * A real sidebar, in a box, rather than a page describing the one on the left.
 *
 * ## Why this used to be prose
 *
 * The desktop sidebar is `fixed inset-y-0 h-svh`: pinned to the VIEWPORT, not
 * to whatever contains it. Rendered inline it would lie across the whole
 * window, over the app's own rail. `AppShell` had already solved that for its
 * `fill` mode, and the fix is the class string on the provider below, copied
 * from it: make the provider a containing block and re-anchor
 * `[data-slot=sidebar-container]` to it. So the specimen is contained by the
 * component's own documented escape hatch rather than by a hack invented here.
 *
 * ## What a second provider costs, and what it does not
 *
 * `SidebarProvider` writes a `sidebar_state` cookie on every toggle. Nothing
 * in this repo reads it - `AppShell` keeps its own collapsed flag in the
 * `alepha-ui` cookie through `useSidebarState` - so the preview cannot move
 * the app's rail, which was the hazard worth checking before nesting one.
 *
 * ⚠️ It also binds ⌘B on `window`, and both providers answer it: the shortcut
 * toggles this preview AND the rail on the left. That is not fixable from
 * here, and it is one of the reasons `SettingsNav` refuses to build its own
 * rail out of `SidebarMenuButton` - see that component.
 *
 * `SidebarInset` is a `<main>`, so inside the preview pane it is nested in the
 * app's own. That is a property of previewing a shell inside a shell, not of
 * the component: in an application it is the only one.
 *
 * ## Not variants
 *
 * `sidebar` / `floating` / `inset` are missing on purpose. They change how the
 * rail meets the page around it, which is a question about the shell, and
 * `/blocks/shell` already answers it by driving the real one. `side` and
 * `collapsible` are this component's own and are here.
 */
const KNOBS = z.object({
  collapsible: z
    .enum(["icon", "offcanvas", "none"])
    .default("icon")
    .meta({ title: "collapsible" }),
  side: z.enum(["left", "right"]).default("left").meta({ title: "side" }),
  groups: z.boolean().default(true).meta({ title: "Group labels" }),
  badges: z.boolean().default(true).meta({ title: "Badges" }),
  submenu: z.boolean().default(true).meta({ title: "Sub-menu" }),
  footer: z.boolean().default(true).meta({ title: "Footer" }),
});

/**
 * An unlabelled first group, then two labelled ones - the shape `AppShell`
 * builds from its `nav` prop, and the reason a `NavGroup` with an empty label
 * renders no heading.
 */
const GROUPS: {
  label?: string;
  items: {
    key: string;
    label: string;
    icon: typeof HomeIcon;
    active?: boolean;
    badge?: number;
    children?: string[];
  }[];
}[] = [
  {
    items: [{ key: "home", label: "Home", icon: HomeIcon }],
  },
  {
    label: "Workspace",
    items: [
      { key: "projects", label: "Projects", icon: FolderKanban, active: true },
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
        children: ["Analytics", "Vitals", "Errors"],
      },
    ],
  },
];

const SidebarPage = () => {
  // The sub-menu's own disclosure. `SidebarMenuSub` carries
  // `group-data-[collapsible=icon]:hidden`, so collapsed to icons this branch
  // is unreachable whatever it is set to - which is why `AppShell` swaps the
  // whole group for a dropdown at that width.
  const [subOpen, setSubOpen] = useState(true);

  return (
    <Showcase
      id="blocks/SidebarPage"
      title="Sidebar"
      description="The navigation rail, as its own specimen."
      schema={KNOBS}
      initialValues={{
        collapsible: "icon",
        side: "left",
        groups: true,
        badges: true,
        submenu: true,
        footer: true,
      }}
      fill
    >
      {(v) => {
        const rail = (
          <Sidebar side={v.side} collapsible={v.collapsible}>
            <SidebarHeader>
              <div className="flex items-center gap-2 px-2 py-1.5 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                  α
                </span>
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  Acme
                </span>
              </div>
            </SidebarHeader>

            <SidebarContent>
              {GROUPS.map((group) => (
                <SidebarGroup key={group.label ?? "_"}>
                  {v.groups && group.label ? (
                    <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  ) : null}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const expandable = !!item.children && v.submenu;
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton
                              isActive={item.active}
                              // The label again as a tooltip: collapsed to
                              // icons it is the only thing naming the row, and
                              // the component hides it at every other width
                              // itself.
                              tooltip={item.label}
                              onClick={
                                expandable
                                  ? () => setSubOpen((open) => !open)
                                  : undefined
                              }
                            >
                              <item.icon />
                              <span>{item.label}</span>
                              {expandable ? (
                                <ChevronRight
                                  className={cn(
                                    "ml-auto transition-transform",
                                    subOpen && "rotate-90",
                                  )}
                                />
                              ) : null}
                            </SidebarMenuButton>

                            {v.badges &&
                            item.badge !== undefined &&
                            !expandable ? (
                              <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                            ) : null}

                            {expandable && subOpen ? (
                              <SidebarMenuSub>
                                {item.children?.map((child) => (
                                  <SidebarMenuSubItem key={child}>
                                    <SidebarMenuSubButton>
                                      <span>{child}</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            ) : null}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>

            {v.footer ? (
              <SidebarFooter>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Support">
                      <LifeBuoy />
                      <span>Support</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarFooter>
            ) : null}

            {/* The drag edge. Nothing to toggle when the rail cannot collapse,
                so it is left out rather than rendered inert. */}
            {v.collapsible === "none" ? null : <SidebarRail />}
          </Sidebar>
        );

        return (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
            <SidebarProvider
              // Lifted verbatim from `AppShell`'s `fill` mode: the provider
              // becomes the containing block, and the otherwise viewport-fixed
              // panel is re-anchored to it. Without this the rail escapes the
              // box and covers the page.
              className="relative h-full min-h-0 [&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:h-auto"
            >
              {/* ⚠️ `side` is not only a prop: the rail has to be on that side
                  of the content IN THE DOM too, which is why this is ordered
                  rather than always rendered first.

                  `Sidebar` draws two things - a spacer that sits in the flex
                  row and reserves the width, and the panel itself, which is
                  taken out of flow and pinned to `side`. Left the two agree.
                  Render it first with `side="right"` and they do not: the
                  spacer holds a column open on the left while the panel paints
                  on the right, so the page is squeezed into the middle and its
                  right edge disappears under the rail. */}
              {v.side === "right" ? null : rail}

              <SidebarInset className="min-w-0">
                <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                  <SidebarTrigger />
                  <span className="text-sm font-medium">The page</span>
                </header>
                <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
                  <p className="text-sm">
                    The trigger and the drag edge both call{" "}
                    <code className="bg-muted rounded px-1">toggleSidebar</code>
                    . What that does is the{" "}
                    <code className="bg-muted rounded px-1">collapsible</code>{" "}
                    knob: <span className="font-medium">icon</span> shrinks the
                    rail to its icons,{" "}
                    <span className="font-medium">offcanvas</span> slides it
                    away entirely, and <span className="font-medium">none</span>{" "}
                    leaves it fixed, so the trigger stays and does nothing.
                  </p>
                  <p className="text-sm">
                    Below <code className="bg-muted rounded px-1">md</code> the
                    rail is not a rail at all: it becomes a sheet over the page,
                    which the Mobile viewport above shows.
                  </p>
                  <p className="text-muted-foreground text-sm">
                    An application rarely builds this tree by hand.{" "}
                    <code className="bg-muted rounded px-1">AppShell</code>{" "}
                    takes a <code className="bg-muted rounded px-1">nav</code>{" "}
                    array and renders exactly what is beside this text:
                  </p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
                    {`{
  label: "Operations",
  items: [
    { href: "/apps", label: "Apps", icon: Boxes, badge: 3, active },
    { label: "Insights", icon: Gauge, defaultOpen, children: [
      { href: "/insights/analytics", label: "Analytics" },
    ] },
  ],
}`}
                  </pre>
                  <p className="text-muted-foreground text-sm">
                    A group with an empty label draws no heading, which is what
                    puts Home on its own above the rest. An item with{" "}
                    <code className="bg-muted rounded px-1">children</code>{" "}
                    becomes a toggle and its own{" "}
                    <code className="bg-muted rounded px-1">href</code> is
                    ignored, so a parent is never a destination.
                  </p>
                </div>
              </SidebarInset>

              {v.side === "right" ? rail : null}
            </SidebarProvider>
          </div>
        );
      }}
    </Showcase>
  );
};

export default SidebarPage;

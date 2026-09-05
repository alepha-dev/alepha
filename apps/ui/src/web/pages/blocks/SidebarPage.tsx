import { Badge } from "@alepha/ui/components/ui/badge";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The sidebar cannot be previewed in a box: it is already on screen, and a
 * second `SidebarProvider` would fight the first over the collapse state. So
 * this documents the shape `AppShell` takes as `nav`, and points left.
 */
const SidebarPage = () => (
  <Showcase
    id="blocks/SidebarPage"
    title="Sidebar"
    description="The navigation tree, on the left."
  >
    {() => (
      <div className="max-w-2xl space-y-8">
        <Group title="A leaf">
          <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
            {`{ href: "/blocks/table", label: "Table", icon: Table2, active }`}
          </pre>
          <p className="text-sm">
            <code className="bg-muted rounded px-1">icon</code> takes a
            component or an already-rendered node, so nav metadata declared on a{" "}
            <code>$page</code> can carry its own.
          </p>
        </Group>

        <Group title="A collapsible group">
          <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
            {`{
  label: "Forms",
  icon: SlidersHorizontal,
  defaultOpen: true,
  children: [
    { href: "/blocks/controls", label: "Controls" },
    { href: "/blocks/select", label: "Select" },
  ],
}`}
          </pre>
          <p className="text-sm">
            An item with <code className="bg-muted rounded px-1">children</code>{" "}
            becomes a toggle and its own <code>href</code> is ignored, so a
            parent is never a destination. <code>defaultOpen</code> falls back
            to whether a descendant is active, which stops a deep link landing
            inside a collapsed group.
          </p>
        </Group>

        <Group title="Badges and collapse">
          <div className="flex items-center gap-3">
            <Badge variant="tint" tone="info">
              badge
            </Badge>
            <span className="text-sm">
              A trailing badge is hidden once the sidebar collapses to icons.
            </span>
          </div>
        </Group>

        <Group title="Groups">
          <p className="text-sm">
            <code className="bg-muted rounded px-1">NavGroup</code> is a label
            and its items. An empty label renders no heading, which is what puts
            Home on its own above Blocks and Pages.
          </p>
        </Group>
      </div>
    )}
  </Showcase>
);

export default SidebarPage;
